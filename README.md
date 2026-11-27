# Tada

单用户、多端同步的待办应用。本地优先：每台设备有自己的本地库，点按立即生效、断网可用；中继只负责收发和冲突裁决。

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

npm run dev:web      # Vite，5173；/api 代理到 8787
npm run dev:relay    # wrangler dev，8787
npm run typecheck    # 三个 workspace 一起检查
npm run build        # 构建前端到 web/dist
npm run deploy       # 构建 + 部署 Worker（前端和 API 同源）
```

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

## 设计要点

- **本地优先**：所有读写先落本地库，同步是后台行为，不阻塞交互。
- **行级 LWW + HLC**：同一行以 HLC 较大者为准，服务端只做字符串比较。
- **墓碑删除**：删除是标记而非物理删除。
- **typed 校验**：服务端认识 `lists` / `tasks`，非法数据 400 不落库；同时对未知字段宽容，旧客户端不会被新服务端打死。
