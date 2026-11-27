# Tada 产品规格 v1

单用户、多设备、本地优先的待办应用。Wunderlist 的核心体验，去掉一切需要别人参与或需要后台推送的功能。

## 原则

1. **本地优先**：任何操作先写本地库、立即刷新 UI，同步是后台行为，不阻塞交互。
2. **离线可用**：断网时读写完全正常，联网后自动补推/补拉。
3. **单人边界**：不需要多用户、分享、权限、提醒、通知。
4. **协议只写一遍**：实体类型、校验、HLC 全部来自 `@tada/shared`。

## 范围

### 做

- 列表：新建、重命名、换色、删除、拖拽排序
- 任务：快速新建、行内改标题、备注、截止日期、完成/取消完成、删除、拖拽排序、移动到其他列表
- 子任务：任务详情内添加、勾选、删除，最多一层；父任务行显示完成进度
- 视图：侧栏全部列表、单列表、今天（含逾期）、已完成折叠区
- 搜索：跨列表按标题/备注过滤
- 同步：多端、离线、行级 LWW
- 中继可选：不连接时是纯本地单机；配对码换 token 后才有跨端同步
- 鉴权：配对码换 token，token 存本地；401 清 token，本地继续可用
- PWA：可安装、离线壳、自动更新
- 状态：同步中 / 已同步 / 离线 / 仅本机 / 同步失败
- 响应式：手机优先，桌面双栏
- 设置：中继连接（配对码）、设备名、上次同步时间、立即同步、解除配对、本地数据持久化状态与导出备份

### 不做

- 提醒、通知、日历集成（用户明确不要）
- 多用户、共享列表、任务分配
- 附件、评论、活动流
- 主题切换（跟随系统）
- 数据导入恢复（导出 JSON 备份已提供；导入不算验收项）

## 数据模型（IndexedDB / Dexie）

```
lists
  id           string  PK
  name         string
  color        string | null
  orderKey     string
  hlc          string
  createdAt    string  ISO
  updatedAt    string  ISO
  deleted      0 | 1
  remote       0 | 1   // 是否进过推送负载或从服务端拉取过（决定删除是否推墓碑）

tasks
  id           string  PK
  listId       string
  parentId     string | null   // 父任务 id；null = 顶层任务（只支持一层）
  title        string
  notes        string | null
  done         0 | 1
  doneAt       string | null
  dueAt        string | null   // YYYY-MM-DD
  orderKey     string
  hlc          string
  createdAt    string
  updatedAt    string
  deleted      0 | 1
  remote       0 | 1   // 同上

meta           // key-value
  deviceId       string  uuid
  deviceName     string
  token          string | null
  lastSeq        number
  lastHlc        string | null   // 本地 HLC 水位，启动时从这里继续
  lastSyncedAt   string | null   // 最近一次完整同步的时间
  pairReseed     0 | 1           // 刚配对：首次全量 pull 后补推服务端没有的本地行

outbox         // 按行折叠的待推送队列
  key          string  PK   // `${entity}:${rowId}`
  entity       'lists' | 'tasks'
  rowId        string
  hlc          string
  queuedAt     number

quarantine     // 被服务端 4xx 永久拒绝、已跳过同步的毒丸条目
  key            string  PK   // 与 outbox 相同的 `${entity}:${rowId}`
  entity         'lists' | 'tasks'
  rowId          string
  hlc            string
  reason         string
  quarantinedAt  number
```

索引：`tasks.listId`、`tasks.parentId`、`tasks.done`、`tasks.orderKey`、`lists.orderKey`、`outbox.queuedAt`、`quarantine.quarantinedAt`。

## 同步引擎

### 本地写入

1. `hlc = clock.next()`
2. 在同一个 Dexie 事务里写行 + upsert `outbox` 条目（同一 `key` 覆盖）
3. 防抖 1s 触发 push

### push

- 取 `outbox` 最早 200 条（客户端单批上限 `PUSH_BATCH_LIMIT`；服务端单请求最多接受 500 条）
- 逐条读出对应行，组装 `WireChange`（`data` 不含 id，含 createdAt/updatedAt）
- `POST /api/v1/sync/push`，带 `Authorization: Bearer <token>`
- 成功后：只删除 `outbox` 中 hlc 小于等于本次推送 hlc 的条目（避免误删请求期间的新改动）；
  同一 key 上因 4xx 留下的 `quarantine` 记录也在版本不新于本次推送时一并删除

### pull

- `GET /api/v1/sync/pull?since=<lastSeq>&limit=500`
- 对每条 change：
  - 本地无该行 → 写入
  - 本地有 → `incoming.hlc > local.hlc` 才覆盖
  - 覆盖时如果该行在 outbox 里，删掉对应 outbox 条目（本地版本已被更新版本淘汰）
- `lastSeq = nextSince`
- `hasMore` → 立即再拉一页

### 触发

- 本地改动后 1s 防抖
- `window.focus`
- `visibilitychange` 变为可见
- 可见状态下每 30s
- 手动「立即同步」
- `online` 事件立即重试

### 失败

- 指数退避 1s → 2s → 4s … 上限 60s
- 离线时暂停定时器，`online` 后立即重试
- 401：清除 token，停止同步，本地继续可用，设置里提示重新配对
- 其他错误：状态显示「同步失败」，保留 outbox，下个触发点重试

### 删除

- 已推送过的行：写 `deleted = 1` + 新 hlc，进 outbox 推墓碑
- 从未推送过的行（outbox 里存在且从未成功过）：本地直接删除，并从 outbox 移除，不推
- 墓碑行在 UI 层过滤，永不物理删除（v1）

## 中继与鉴权

- 中继是可选的传输层：不连接时应用照常启动、读写本地库，只是没有跨端同步
- 设置页「中继」一栏未连接时显示配对码 + 设备名表单（设备名默认从 UA 推断，可改）
- `POST /api/v1/pair` → 存 token → 全量 pull
- 所有请求带 `Authorization: Bearer <token>`
- 401 → 清 token，本地继续可用，设置里提示「凭证失效，请重新配对」
- 解除配对只清 token；本地数据与 outbox 保留，重新配对后补推

## UI

移动优先，最小宽度 320px。

- **布局**：桌面左侧固定侧栏 + 右侧内容；移动端侧栏为抽屉，顶栏左侧汉堡按钮
- **侧栏**：今天、全部、分隔线、每个列表（色点 + 名称 + 未完成数）、底部「新建列表」
- **单列表页**：标题、任务数、快速添加框（回车创建并保持焦点）、未完成任务、已完成折叠区
- **任务行**：拖拽手柄、复选框、标题（点击进入编辑/详情）、截止日期 chip（逾期红色）、备注图标、更多菜单（移动列表、删除）
- **子任务**：任务详情内显示清单与 `已完成/总数`，回车添加、勾选完成、点击标题打开子任务详情、悬停删除；子任务详情可回跳父任务。父任务行显示 `2/5` 进度 chip，只在详情里展开子任务
- **今天**：`dueAt <= 今天` 且未完成，按日期分组或排序，逾期标红
- **全部**：按列表分组展示未完成任务
- **搜索**：顶栏搜索框，跨列表匹配标题/备注，显示所属列表；命中的子任务额外标注 `↳ 父任务`
- **空状态**：无列表、无任务、搜索无结果，各有文案和引导
- **同步状态**：顶栏小圆点 + 文案（已同步/同步中/离线/仅本机/失败）
- **键盘**：Enter 保存、Esc 取消、`Ctrl/Cmd+K` 聚焦搜索
- **乐观更新**：所有写操作立即反映在 UI，不等网络

视觉：干净、留白充足、圆角、系统字体、深浅色跟随系统。不要花哨动画，但要有 150ms 级别的过渡。

## 排序

- `orderKey` 用 `fractional-indexing` 的 `generateKeyBetween`
- 新任务插到列表顶部
- 拖拽只改被移动的那一行
- 子任务追加到现有子任务末尾，顺序同样用 `orderKey`
- 列表排序同规则

## PWA

- `vite-plugin-pwa`，`registerType: 'autoUpdate'`
- manifest：name/short_name/theme_color/background_color/display standalone/icons 192+512+maskable
- 应用壳预缓存；`/api/*` 一律不缓存
- 图标从一张 SVG 生成；若生成工具不可用，至少要有 SVG 图标 + apple-touch-icon，并在交付说明里写明
- 实例品牌图标：默认是仓库里的「签名火漆」；设置页提供内置图标和可调色的经典对勾，
  最终都以 512 PNG 经 `/api/branding` 存到中继，不新增服务端字段
- iOS 主屏安装使用 `apple-mobile-web-app-capable` 等 meta，以独立窗口打开

## 测试（vitest）

必须覆盖：

- HLC：单调递增、同毫秒计数、时间回拨
- LWW：新覆盖旧、旧被忽略、相等不写
- outbox：同一行多次改动只留最新；create+delete 抵消
- pull 合并：跨表按 seq 排序、游标推进、hasMore
- 排序 key：头部、尾部、中间插入
- 子任务：创建与追加顺序、级联完成、级联删除（物理 / 墓碑）、父任务移动携带子任务、拒绝嵌套
- relay：真实 `schema.sql` 上的配对 / push / pull / LWW / 墓碑，以及完整 HTTP 层的两台客户端同步闭环

UI 组件测试不强制。

## 已知限制

- 同步是行级 LWW，没有字段级合并：同一行两端同时改不同字段时，hlc 较大的一侧整行胜出。
- 删除是墓碑（`deleted = 1`），永不物理删除；长期使用后本地库会保留墓碑行。
- 移动端任务拖拽使用手柄；列表重排在触摸设备上需要长按约 220ms 再拖动，避免和滚动抢手势。
- 重新配对后的自动补推：首次全量 pull 完成后，把「本地有、服务端没有」的未删除行重新入队（服务器为空只是特例）；设置页「重新上传本地数据」保留为手动兜底。
- HLC 设备段是「安装级 12 位稳定前缀 + 每个标签页 5 位随机后缀」，因此同一设备不同标签页的后缀不同（每页重新生成）。跨重载的严格单调性不依赖设备段，而由 `meta.lastHlc` 持久化水位保证：启动时从该水位继续，`next()` 永远大于历史值。同一毫秒内不同标签页若生成了相同的计数，则由设备段（含 5 位随机后缀）的字典序决胜，与 LWW 的字符串比较规则一致，结果确定。
- 配对 token 以明文保存在 IndexedDB（`meta.token`）。同源 XSS 可以读到它；当前通过 React 的自动转义与同源部署降低风险，但这不是加密存储。
- 设备名在配对时登记到中继；连接后修改只影响本机显示，不会更新服务端 `devices.name`。
- 服务端 4xx 拒绝的单条数据会被客户端隔离（`quarantine` 表）并跳过，其余条目继续同步；本地行保留，修正后下一次编辑会重新入队。设置页会显示「N 条数据不合法，已跳过」，并提供「清除提示」手动清空；该行之后推送成功或被远端新版本覆盖时，隔离记录会自动删除。
- relay push 响应里的 `lastSeq` 仅信息用途，不能作为 pull 游标；客户端以 pull 的 `nextSince` 为准，并在整页返回时无条件再拉一页。
- push 请求体上限 2,000,000 字节，单次最多 500 条改动。
- 图标由 `web/scripts/generate-icons.mjs` 从 `web/public/icons/maskable-source.svg` 生成；改图标请改 SVG 后运行 `npm run icons`，不要手工编辑 PNG。
- 子任务只支持一层，子任务不能再有子任务；子任务不设截止日期、备注和列表归属，跟随父任务。
- 完成父任务时若有未完成子任务，先弹出确认；确认后级联完成子任务，取消则父任务保持未完成。取消完成父任务不会反向恢复子任务（避免覆盖用户单独勾选的结果）。给已完成的父任务添加子任务会重新打开它。
- 子任务跟随父任务换列表、随父任务删除（墓碑与父任务一致），不能单独移动到其他列表。
- 子任务不出现在单列表、今天、全部、已完成四个视图和侧栏计数中（这些位置只统计顶层任务）；搜索会匹配子任务并标注 `↳ 父任务`。
- 任务行内重命名在「更多 → 重命名」；单击标题仍然打开详情，两者不冲突。
- 本地数据只有 IndexedDB 一份。启动时会尝试申请持久化存储，设置页显示结果并提供 JSON 导出备份；导入恢复尚未实现。清理站点数据、浏览器回收空间或 iOS 长期不用都可能丢失本地数据（已连接中继时服务端还有一份）。
- 配对码过期超过一天后会在下一次配对时清理。配对接口没有单独做 IP 限流：码是 40 bit、10 分钟过期，在线暴力枚举不可行；如需更严格可在 Cloudflare 层加 Rate Limiting 规则。
- 仍不支持导入恢复与主题切换；导出备份已提供。

## 本地联调

```bash
# 终端 A
cd <repo>
npm run db:init:local -w @tada/relay
npx wrangler d1 execute tada --local --command \
  "INSERT INTO pairing_codes (code, expires_at) VALUES ('AAAA111111', strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))"
npm run dev:relay          # 127.0.0.1:8787

# 终端 B
npm run dev:web            # 127.0.0.1:5173，/api 代理到 8787
```

打开 5173 即可使用（默认仅本机）；在 设置 → 中继 里用配对码 `AAAA111111` 连接后测多端同步。

## 验收

在仓库根目录：

```bash
npm run typecheck
npm run test
npm run build
```

三条都必须 exit 0。

## 禁止

- 不改 relay 的端点路径、请求/响应字段与语义。确需扩展时只能新增可选字段，并在交付说明里列出。
- 不执行 `wrangler deploy` / `d1 create` / 任何需要账号的操作。
- 不引入需要本地编译原生模块的依赖。
- 不删除 `@tada/shared` 已有的导出。
