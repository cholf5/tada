<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="Tada 图标">
</p>

<h1 align="center">Tada</h1>

<p align="center">单用户、多端同步的待办应用。本地优先：每台设备有自己的本地库，点按立即生效，断网照常使用。</p>

<p align="center">
  <a href="https://github.com/cholf5/tada/actions/workflows/ci.yml"><img src="https://github.com/cholf5/tada/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933.svg" alt="Node.js 24+">
</p>

<p align="center"><a href="README.md">English</a> · 简体中文</p>

> [!IMPORTANT]
> **本项目只提供源码，不提供托管服务。** 想用请自行部署；一个中继只服务一个人。

列表、任务、子任务、今天、全部、搜索，外加一套可选的多端同步。需要别人参与或需要后台推送的东西——协作、共享、提醒、活动流——都被刻意拿掉了。

## 功能

| 功能 | 说明 |
|---|---|
| **列表** | 新建、改名、改色、拖拽排序、删除 |
| **任务** | 快速添加、行内改标题、备注、截止日期、完成与恢复、拖拽排序、移动到其他列表 |
| **子任务** | 在任务详情里添加、勾选、删除，只有一层；父任务显示完成进度 |
| **视图** | 今天（含逾期）、全部、已完成归档、单个列表 |
| **搜索** | 跨列表搜索标题和备注，命中的子任务会补上父任务标题 |
| **同步** | 多端增量同步，离线写入，行级 LWW；未配对时完全单机 |
| **安装** | PWA，可添加到主屏幕，离线启动，自动更新 |
| **外观** | 跟随系统自动切换明暗，也可在设置里手动锁定日间或夜间（只影响本机） |
| **语言** | 中文 / English，默认跟随浏览器语言，也可在设置里手动选择（只影响本机） |
| **设置** | 配对、设备名、同步状态、立即同步、解除配对、外观、语言、导出备份、重新上传本地数据 |

## 快速开始

需要 Node.js ≥ 24（relay 测试直接使用内置的 `node:sqlite`）。前端是纯浏览器环境，装好依赖就能跑。

```bash
npm install
npm run dev:web
```

打开 <http://localhost:5173> 即可使用。不启动中继时就是纯本地应用，功能完整。

要测多端同步，再起一个本地中继：

```bash
cp relay/wrangler.toml.example relay/wrangler.toml   # 首次
npm run db:init:local                  # 本地 D1 建表，只需一次
npx wrangler d1 execute tada --local --config relay/wrangler.toml --command \
  "INSERT INTO pairing_codes (code, expires_at) VALUES ('AAAA111111', strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))"
npm run dev:relay                      # 127.0.0.1:8787
```

然后在「设置 → 中继」里填入配对码 `AAAA111111`。Vite 已经把 `/api` 代理到 8787。

## 它是怎么工作的

```text
┌─ 浏览器 / PWA ─────────────────────────────┐
│ React 19 · Vite · Dexie（IndexedDB）       │
│ 所有读写先落本地，UI 立即响应              │
└───────────────┬────────────────────────────┘
                │ push / pull（可选）
┌───────────────▼────────────────────────────┐
│ Cloudflare Worker + D1                     │
│ 配对鉴权 · 行级 LWW · 墓碑删除             │
└────────────────────────────────────────────┘
```

- **本地优先**：写行和 `outbox` 在同一个 Dexie 事务里完成，同步是后台行为；网络失败不回滚 UI。
- **中继可选**：未配对时整条同步链路不存在，应用照常单机工作。
- **行级 LWW + HLC**：同一行以 HLC 较大者为准，服务端只比较字符串。
- **墓碑删除**：删除是 `deleted = 1` 加新 HLC，永不物理删除，避免另一端把行复活。
- **协议只写一遍**：实体类型、zod 校验、HLC 都在 `shared/`，前端和中继各自 import。
- **同源部署**：Worker 同时托管 `web/dist` 和 API，省掉 CORS；PWA 身份固定为 `/`，不随品牌变化。

仓库结构：

```text
shared/   @tada/shared  实体类型、zod 校验、HLC、API 类型
relay/    @tada/relay   Cloudflare Worker + D1，手写 SQL
web/      @tada/web     React 19 PWA，Dexie + @dnd-kit
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev:web` | Vite 开发服务器（5173） |
| `npm run dev:relay` | Wrangler 本地中继（8787） |
| `npm run typecheck` | 三个 workspace 一起类型检查 |
| `npm run test` | 协议、同步引擎、relay SQL 与 HTTP+SQL E2E |
| `npm run build` | 构建前端到 `web/dist` |
| `npm run deploy` | 构建前端并部署 Worker（前端 + API 同源） |
| `npm run db:init` | 在远端 D1 建表或补表 |
| `npm run db:init:local` | 在本地 D1 建表（本地联调） |
| `npm run pair` | 生成一次性配对码，并打印写入 D1 的命令 |
| `npm run icons` | 从 SVG 重新生成 PWA 图标 |

## 部署

完整步骤见 **[`docs/DEPLOY.md`](docs/DEPLOY.md)**。这里是最短路径：

```bash
git clone https://github.com/cholf5/tada.git
cd tada
npm install
npx wrangler login
cd relay
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create tada   # 把 database_id 填进 relay/wrangler.toml
cd ..
npm run db:init
npm run deploy
npm run pair                  # 执行打印出的 wrangler 命令，然后在设置里填配对码
```

- 部署结果是一个 `https://tada-relay.<子域>.workers.dev` 地址：前端、API、PWA manifest 都在上面，自带 HTTPS；不需要 GitHub Pages、服务器或证书。
- `APP_ORIGIN` 只在前后端不同源时（例如前端放在 GitHub Pages）才需要填；Worker 同源托管时保留占位值即可。
- 配对码 10 分钟内有效、只能用一次；每台设备单独生成。
- 升级：`git pull && npm install && npm run db:init && npm run deploy`。

<details>
<summary>自定义实例名称和图标</summary>

自托管的实例可以换成自己的应用名和图标，所有连接的设备都会看到：

1. 配对后在「设置 → 实例品牌」里改名称、选内置图标或上传自己的图片。
2. 上传的图片会先在浏览器里缩成 512×512 PNG 再上传；中继只保存这一张。
3. 未配对时也可以在 `relay/wrangler.toml` 的 `[vars]` 里设置 `APP_NAME`；设置页保存过之后以 D1 为准，再改 `APP_NAME` 不会覆盖。
4. 已经添加到主屏幕的 PWA 需要删除后重新添加，名称和图标才会更新；普通网页刷新即可。
5. 内置图标包括火漆印（默认）、签名火漆、笔记本、纸与丝带、珐琅勾，以及可调色的经典对勾。

</details>

## 数据与备份

> [!WARNING]
> IndexedDB 是本地唯一的一份。清理站点数据、浏览器回收空间或 iOS 长期不用，都可能让它消失。

- 启动时会尝试申请持久化存储，浏览器可以拒绝；设置页能看到当前状态。
- 「设置 → 本地数据」可以导出 JSON 备份，包含列表和任务（含删除墓碑），不含配对 token；导入恢复尚未实现。
- 开了同步时中继上还有一份；纯本地使用请定期导出。

## 测试与 CI

- relay 测试用 Node 内置 `node:sqlite` 执行真实 `schema.sql`；`relay/src/e2e.test.ts` 走完整 HTTP 层：配对、两台客户端 push/pull、LWW、墓碑、分页、401。
- CI 依次执行 typecheck、test、`npm audit --omit=dev --audit-level=high` 和 build。

## 边界

明确不做：多用户与共享列表、提醒与通知、日历集成、附件、评论、活动流、托管服务。完整范围与已知限制见 [`docs/SPEC.md`](docs/SPEC.md)。

更多文档：

- [`docs/DEPLOY.md`](docs/DEPLOY.md) —— 从零部署到 Cloudflare Workers 的完整步骤
- [`docs/SPEC.md`](docs/SPEC.md) —— 产品规格、数据模型、同步规则、验收
- [`relay/README.md`](relay/README.md) —— 中继接口契约、部署与配对
- [`docs/HARDENING.md`](docs/HARDENING.md) —— 加固记录与真机验收清单
- [`AGENTS.md`](AGENTS.md) —— 给协作者的项目约定

---

Apache-2.0，见 [LICENSE](LICENSE)。名称和图标不在许可证授权范围内；fork 请改名。

Tada 是一个独立的开源项目，受 Wunderlist 启发，与 Microsoft Corporation 无关联，也未获其背书或赞助。Wunderlist 是 Microsoft Corporation 的商标。
