# AGENTS.md

> 在这个仓库里工作的 agent / 协作者先读这一份。
> 阅读顺序：**本文 → [`docs/SPEC.md`](docs/SPEC.md) → [`relay/README.md`](relay/README.md) → [`docs/HARDENING.md`](docs/HARDENING.md)**。
> 需求细节以 SPEC 为准，接口契约以 relay/README 为准。
> 本文只讲「为什么做」「不能碰什么」和「已经拍板的决定」，不重复规格里的字段和流程图。

## 这是什么

Tada 是一个受 Wunderlist 启发的**单用户**待办应用：列表、任务、子任务、今天视图、搜索，加一套多端同步。

- 前端是 React PWA，**本地优先**：所有读写先落 IndexedDB，点按立即生效，断网可用。
- 同步靠一个**可选**的 Cloudflare Worker 中继（D1），行级 LWW，没有字段级合并。
- 中继是**单租户**的：一个中继只服务一个人。没有注册、没有分享、没有协作、没有通知。

## 定位（写文档、做取舍时按这个来）

1. **只自托管，不提供托管服务。** 作者只开源代码，不替任何人运行服务。想用的人自己部署。
2. **单租户是硬边界。** 不设计多用户、邀请、权限、共享列表、公开链接；也不要为了「以后可能要多用户」提前抽象。
3. **主要服务作者本人。** 功能优先级由作者的日常使用决定。不要为了想象中的人群扩大范围，也不要以「新手友好」「更容易获得 star」为目标重构。
4. **Wunderlist 的精神续作。** 复刻核心体验，刻意去掉一切需要别人参与或需要后台推送的东西（提醒、通知、活动流、协作）。
5. **开源是顺带的。** 不开源这个项目也成立。所以不做增长、推广、遥测、账号体系这类「产品化」的事。

判断一个新需求该不该做，先问：**作者自己明天会不会用？** 不会，就不做。

## 名字与法律边界

- 项目名是 **Tada**。仓库名、包名、域名、应用标题里都不要出现 Wunderlist。
- Wunderlist 是微软的商标（2015 年收购 6Wunderkinder 时取得，2020 年产品停服不影响商标归属）。
- **可以**：在 README / 文档里写「受 Wunderlist 启发」，属于指示性使用，只要不暗示官方关联。
- **不可以**：用它的名字做产品名或上架标题；使用它的 logo、图标、背景壁纸、音效；把视觉做到像素级一致。
- README 底部已有免责声明，改措辞前先问作者。
- 实例品牌功能的一部分原因就是让使用者换成自己的名字和图标；但仓库的默认值必须干净（见不变量 8）。
- 许可证是 Apache-2.0，第 6 条明确不授予商标权——这就是选它的原因之一。

## 技术栈

| 位置 | 技术 | 说明 |
|---|---|---|
| `shared/` | TypeScript + zod | 协议唯一来源：实体类型、校验 schema、HLC。中继和前端都从这里 import |
| `relay/` | Cloudflare Worker + D1 | 无框架路由，手写 SQL，wrangler 部署。测试用 Node 内置 `node:sqlite` 跑真实 `schema.sql` |
| `web/` | React 19 + Vite 6 + Dexie | PWA 用 `vite-plugin-pwa`（Workbox）；拖拽用 `@dnd-kit`；排序 key 用 `fractional-indexing` |

Node ≥ 24（relay 测试直接依赖 `node:sqlite`）。npm workspaces，无 Turborepo / Nx。

## 数据流（一句话版）

本地写（同一 Dexie 事务里写行 + `outbox` 条目）→ 防抖 1s → `POST /api/v1/sync/push`；
`GET /api/v1/sync/pull?since=<lastSeq>` 增量拉 → 只有 `incoming.hlc` 严格大于本地才覆盖。
未配对时整条同步链路不存在，应用照常单机工作。

## 仓库地图

```
shared/src/    api.ts（请求/响应类型） schemas.ts（zod） entities.ts hlc.ts limits.ts
relay/src/     index.ts（路由） store.ts（SQL） pull.ts http.ts branding.ts
relay/         schema.sql  wrangler.toml
web/src/       db/（Dexie、repo、outbox、backup）
               sync/（engine、push、pull、lww、clock、api）
               ui/（Workspace、Sidebar、各视图、TaskDetail、SettingsView、BrandingCard）
               lib/（branding、builtinIcons、iconResize、dates、colors、storage、i18n）
               state/ hooks/
docs/          SPEC.md（需求来源） HARDENING.md（加固记录 + 真机清单）
               FIX-ROUND*.md（历史轮次） REVIEW-WEB.md（复核清单）
```

## 常用命令

```bash
npm install

npm run dev:web       # Vite 5173；只跑这个也能用（仅本机）
npm run dev:relay     # wrangler dev 8787；测多端同步时再起
npm run typecheck     # 三个 workspace 一起
npm run test          # 协议、同步引擎、relay SQL 与 HTTP+SQL E2E
npm run build         # 构建前端到 web/dist
npm run icons         # 从 SVG 重新生成 PWA 图标（不要手改 PNG）
npm run db:init       # 远端 D1 建表（需要账号，agent 不要执行）
npm run db:init:local # 本地 D1 建表
```

本地联调怎么签发配对码，见 `docs/SPEC.md` 的「本地联调」。

## 工程约定

- **没有 lint / format 脚本**，也没有 ESLint / Prettier 配置。不要顺手引入，除非作者要求。
- 注释、提交信息、文档一律中文。缩进 2 空格，单引号，分号；跟现有代码保持一致。
- `web` 的 vitest 跑在 `node` 环境（没有 jsdom），只测纯逻辑。要测 DOM 得先加依赖，先问。
- `relay` 的测试加载真实 `schema.sql`，改表结构必须同步改 `relay/schema.sql`；e2e 会走完整 `worker.fetch`。
- PWA 相关改动（manifest / Service Worker / 缓存）容易在浏览器里静默失效：改完至少跑一次 `npm run build`，并检查 `web/dist/sw.js` 里的预缓存清单和 runtime route。
- 图标不要手改 PNG，改 `web/public/icons/maskable-source.svg` 后跑 `npm run icons`。

## 不变量（改代码前必须知道）

1. **协议只写一遍。** 实体类型、校验、HLC 只在 `@tada/shared`；`relay` 和 `web` 各自 import，不复制一份。
2. **本地优先。** 任何写操作先写本地库、立即更新 UI，同步是后台行为；网络失败不回滚 UI。
3. **pull 游标只能来自 `nextSince`。** push 响应里的 `lastSeq` 仅信息用途，绝不能拿来当游标。
4. **墓碑不物理删除。** 删除是 `deleted = 1` + 新 hlc，v1 永远保留。
5. **中继可选。** 未配对时应用必须完整可用；任何新功能都不能假设「一定有服务器」。
6. **API 路径和字段冻结。** 不改已有端点、请求/响应字段与语义；确需扩展只能新增可选字段，并写进交付说明。
7. **PWA 身份固定。** manifest 的 `id`、`start_url`、`scope` 都是 `"/"`，不能跟品牌配置走。
8. **品牌默认值不得包含任何 Wunderlist 的名字或资产。** 自定义名称和图标只由使用者自己填；仓库里不预置实例、壁纸、音效。
9. **不执行需要账号的操作。** `wrangler login` / `deploy` / `d1 create` 一律不碰。
10. **不引入需要本地编译原生模块的依赖。** relay 跑在 Workers 里，web 是纯浏览器环境。
11. **不删除 `@tada/shared` 已有的导出。**

## 验证

改完在仓库根目录跑，三条都必须 exit 0：

```bash
npm run typecheck
npm run test
npm run build
```

CI（`.github/workflows/ci.yml`）还要跑 `npm audit --omit=dev --audit-level=high`。
不要为了通过而注释掉已有测试；现有测试覆盖的是同步正确性，不是装饰。

## 已定的决策（不要重新讨论）

这些是作者明确拍板的。遇到相关需求直接照做，不要提案推翻：

| 主题 | 结论 |
|---|---|
| 多用户 / 共享 / 协作 | 不做，也不会做 |
| 提醒 / 通知 / 日历集成 | 不做 |
| 托管服务 / SaaS | 不提供，只开源代码 |
| 许可证 | Apache-2.0（保留商标权） |
| 同步模型 | 行级 LWW，不做字段级合并 |
| 删除 | 墓碑标记，v1 不物理删除 |
| 中继 | 单租户，一个中继服务一个人 |
| 品牌 | 中继侧单行配置，全实例生效；只存一张 512 PNG，浏览器端缩放 |
| PWA 身份 | manifest `id` 固定 `/`，不随品牌变化 |
| 主题 | 默认跟随系统；设置里可手动锁定日间 / 夜间，选择只存本机 |
| 语言 | 只做中文 / English；默认跟随浏览器语言，可手动选择，选择只存本机 |

## 文档约定

- 代码注释、提交说明、文档都用中文。
- `docs/SPEC.md` 是需求来源。实现和 SPEC 冲突时，先问作者，不要自作主张改 SPEC。
- `docs/FIX-ROUND*.md` 是逐轮修复的历史记录，**只追加、不改写**；新一轮写新文件。
- 提交说明格式：`feat|fix|docs|test: 一句话摘要`，必要时跟 `-` 列表。

## 当前状态

- 仓库**尚未部署到任何地方**。`relay/wrangler.toml` 里的 `database_id` 和 `APP_ORIGIN` 仍是 `REPLACE_ME` / `YOUR-SUBDOMAIN` 占位符。
- 功能上 v1 完整；实例品牌是最后加的一块（中继 D1 单行配置 + Worker 动态 manifest/HTML + 设置页卡片）。
- 真实设备验收还没做：iOS 主屏安装、手机长按拖拽、飞行模式离线，清单在 `docs/HARDENING.md`。
- 没有发布过版本 tag，也没有 release 页面。

## 路线图

v1 已经完成：列表 / 任务 / 子任务 / 今天 / 全部 / 搜索 / 多端同步 / 离线 / PWA / 设置 / 备份导出 / 实例品牌。

当前阶段：**补齐发布物**。

- 已完成：Apache-2.0 `LICENSE`、`AGENTS.md`、README、SPEC、CI。
- 待做：截图、部署文档、可选的公开演示（只读，不代表提供托管服务）。
- 之后未定。明确不打算做：多用户、共享、通知、托管服务。

## 已知限制

不要在这里重复维护清单，直接看：

- `docs/SPEC.md` → 「已知限制」「禁止」
- `docs/HARDENING.md` → 「仍未处理」「真机验收清单」

其中真机验收（iOS 主屏、长按拖拽、飞行模式）尚未完成，改 PWA 相关代码时留意。
