# Tada

单用户、多端同步的待办应用。本地优先：每台设备有自己的本地库，点按立即生效、断网可用；中继只负责收发和冲突裁决。

**本项目只提供源码，不提供托管服务。** 想用请自行部署；一个中继只服务一个人。

## 结构

```
tada/
├── shared/    @tada/shared  协议、实体类型、zod 校验、HLC —— 只写一遍
├── relay/     @tada/relay   Cloudflare Worker + D1
└── web/       @tada/web     React PWA（Vite）
```

`shared` 是唯一的接口定义处：实体类型、校验 schema、HLC 编码都从这里出，中继和前端各自 import，不会漂移。

## 常用命令

开发前提：Node.js ≥ 24（relay 测试直接用内置的 `node:sqlite`，Node 22 需要额外的实验开关）。

```bash
npm install

npm run dev:web      # Vite，5173；只跑这个也能用（仅本机）
npm run dev:relay    # wrangler dev，8787；要测多端同步时再起
npm run typecheck    # 三个 workspace 一起检查
npm run test         # 协议、同步引擎、relay SQL 与 HTTP+SQL E2E
npm run build        # 构建前端到 web/dist
npm run deploy       # 构建 + 部署 Worker（前端和 API 同源）
```

## 本地数据与备份

本地数据在 IndexedDB 里，是唯一一份：

- 启动时会尝试 `navigator.storage.persist()` 申请持久化存储；浏览器可以拒绝。
- 设置 → 本地数据可以看到持久化状态，并导出 JSON 备份。
- 备份包含列表和任务（含已删除墓碑），**不包含**配对 token；导入恢复尚未实现，需要手工处理。
- 清理站点数据、浏览器回收空间或 iOS 长期不用都可能让本地数据消失。开了同步时中继上还有一份；纯本地使用时请定期导出。
- iOS 主屏安装依靠 `apple-mobile-web-app-capable` 等 meta 以独立窗口打开；更细的真机行为见 `docs/HARDENING.md`。

## 测试与 CI

- relay 的测试用 Node 内置 `node:sqlite` 执行真实 `schema.sql`，其中 `relay/src/e2e.test.ts` 走完整 HTTP 层：配对、两台客户端 push/pull、LWW、墓碑、分页、401。
- GitHub Actions 配置在 `.github/workflows/ci.yml`，依次执行 typecheck、test、生产依赖审计和 build。

## 中继

接口契约见 [`relay/README.md`](relay/README.md)。

首次部署：

```bash
cd relay
npx wrangler login
npx wrangler d1 create tada      # 把 database_id 填进 wrangler.toml
cd ..
npm run db:init
npm run deploy
```

## 自定义名称和图标

自托管的实例可以改成自己的应用名和图标，所有连接的设备都会看到：

1. 配对后在「设置 → 实例品牌」里改名称、上传图标，保存即可。
2. 也可以不配对，直接在 `relay/wrangler.toml` 的 `[vars]` 里设置
   `APP_NAME = "你的应用名"`。注意：一旦在设置页保存过，就以 D1 里的值为准，
   之后修改 `APP_NAME` 不会覆盖它。
3. 图标只需上传一张正方形图片（PNG / JPEG / WebP），浏览器会先在本地缩成
   512×512 的 PNG 再上传；中继只保存这一张图。
4. 已经添加到主屏幕的 PWA 需要删除后重新添加，名字和图标才会更新；普通网页
   刷新后立即生效。
5. 已有的部署升级后要先跑一次 `npm run db:init`，否则缺 `branding` 表，
   设置页保存会失败。

## 设计要点

- **本地优先**：所有读写先落本地库，同步是后台行为，不阻塞交互。
- **中继可选**：不连接中继时就是纯本地单机应用；连上中继后才有跨端同步。
- **行级 LWW + HLC**：同一行以 HLC 较大者为准，服务端只做字符串比较。
- **墓碑删除**：删除是标记而非物理删除。
- **typed 校验**：服务端认识 `lists` / `tasks`，非法数据 400 不落库；同时对未知字段宽容，旧客户端不会被新服务端打死。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。名称和图标不在许可证授权范围内；fork 请改名。

## 声明

Tada 是一个独立的开源项目，受 Wunderlist 启发，与 Microsoft Corporation 无关联，也未获其背书或赞助。Wunderlist 是 Microsoft Corporation 的商标。
