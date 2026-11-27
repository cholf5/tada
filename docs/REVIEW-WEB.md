# Web 端复核清单（W1–W38）

上一轮独立复核提出的检查项。本轮 reviewer 逐条判定，给出「通过 / 不通过 / 未覆盖」与证据（文件:行号或复现步骤）。

| # | 检查项 | 判定标准 |
|---|---|---|
| W1 | 无 token 启动 | 直接进配对页，不调用 /sync/* |
| W2 | 配对成功流程 | 存 token → since=0 全量 pull 循环 → 完成后才显示「已同步」 |
| W3 | 401 处理 | 清 token、停同步、跳配对页、提示；数据与 outbox 保留；不无限重试 |
| W4 | 非 401 失败 | 保留 token/outbox，指数退避 1→60s；离线暂停；online 立即重试 |
| W5 | Authorization | 一律 Bearer；token 不进 URL/日志 |
| W6 | 解除配对 | 清 token+lastSeq 并停同步；不得声称服务端已注销 |
| W7 | 配对码输入 | 去空白；与 relay 大写 hex 精确匹配 |
| W8 | HLC device 段 | ≤32 字符、稳定、字符集合法；formatHlc 不抛错 |
| W9 | 本地写事务 | 行 + outbox 同一 Dexie 事务；outbox key=entity:id 覆盖 |
| W10 | 删除策略 | 进入过 push 负载的行删除必发墓碑；仅从未进入过的才本地直删 |
| W11 | 墓碑过滤 | 所有视图、计数、搜索排除 deleted=1 |
| W12 | 拉取回灌时钟 | 应用每条 change 后本地时钟 ≥ incoming.hlc |
| W13 | lastHlc 持久化 | 重启后 next() 大于历史任何 hlc |
| W14 | 多标签一致 | 无相同/逆序 hlc |
| W15 | push 组装 | 最早 500 条；data 不含 id/hlc/deleted；含 createdAt/updatedAt，编辑时原样带回 |
| W16 | push 成功清理 | 只删 hlc ≤ 本次推送最大 hlc 的 outbox 条目 |
| W17 | lastSeq 红线 | 绝不用 push 响应 lastSeq 设 pull 游标 |
| W18 | 被拒变更对账 | 本地最终与服务端一致，不长期显示被拒版本 |
| W19 | 400/毒丸 | 校验失败不无限重试，不阻塞整条 outbox |
| W20 | 同步互斥 | 同一时刻只有一个 push/pull 流程 |
| W21 | pull 请求 | since=meta.lastSeq&limit=500 |
| W22 | pull 应用 | 无则写；有则 hlc 严格大于才覆盖；相等不写 |
| W23 | outbox 清理 | 远端覆盖本地时删对应 outbox（仅当 hlc ≤ incoming） |
| W24 | 游标推进 | 成功后 lastSeq=nextSince；hasMore=true 继续 |
| W25 | 分页兜底 | page.length === limit 时继续拉，即使 hasMore=false |
| W26 | 墓碑带 data | deleted=true 忽略 data，只置 deleted=1 |
| W27 | 引用完整性 | listId 指向已删除/未同步列表时 UI 兜底，不崩溃 |
| W28 | 全量完成判定 | hasMore=false 且本页未满才置「已同步」 |
| W29 | 本地类型映射 | 本地行 = shared 实体 + hlc + deleted；done boolean↔0/1 集中实现 |
| W30 | 时间字段 | dueAt 严格 YYYY-MM-DD，字符串比较，不按本地时区解析 |
| W31 | color 渲染 | 白名单/hex 校验后才进 style |
| W32 | 排序 key | fractional-indexing；拖拽只改被移动行；头部/尾部/空列表有测试 |
| W33 | 乐观更新 | 网络失败不回滚 UI；仅由更高 hlc 覆盖 |
| W34 | 今天/全部/搜索 | 全本地计算；今天 = dueAt ≤ 本地今天且未完成 |
| W35 | 触发点 | 写后 1s、focus、visibilitychange、可见 30s、online、手动，同一流程 |
| W36 | 状态机 | 未配对/同步中/已同步/离线/失败 转移正确；有未完成流程时不显示已同步 |
| W37 | SW 与 PWA | /api 不缓存；离线壳可用；autoUpdate 生效 |
| W38 | 空状态 | 无列表/无任务/搜索无结果 三种齐全 |

## 第二轮修复的验证点

逐条确认这些改动真实存在且测试真的能抓住回归（必要时把代码复制到 /tmp 做变异验证，不要改仓库文件）：

- A1 分页：单表剩余 > limit 时 hasMore=true；把 `limit + 1` 改回 `limit` 测试必须失败。
- A2 配对：UPDATE 与 INSERT 在同一 batch。
- A3 非法 JSON → 400。
- A4 体积 > 2MB → 413。
- A5 未知 /api/* → 404 JSON。
- A6 since/limit clamp，limit=0 → 1。
- A7 所有 API 响应 Cache-Control: no-store。
- A8 墓碑写 updated_at。
- A9/A10 schema 收紧与 web 实际写入格式兼容。
- A11 返回值用 shared 类型，未知实体 400。
- B14/B15/B16 三个 workspace 的测试真实执行。
- C17 移动端触摸拖拽（dnd-kit：Pointer/Touch/Keyboard）。
- C18 useToday 跨午夜。
- C19 详情草稿与远端更新。
- C20 空服务器重推 + 手动按钮。
- C21 图标脚本可重跑。

## 重点怀疑区

- `web/src/sync/engine.ts` 的并发与状态机（W20/W36）。
- `web/src/sync/pull.ts` 与 `push.ts` 的边界（W22/W23/W25/W28）。
- `web/src/db/repo.ts` 的删除与排序（W10/W32）。
- dnd-kit 改动后桌面拖拽是否退化、键盘排序是否可用。
- relay 的 `readJson` 是否在 413 之前不读入内存（先看 content-length 或分块）。
