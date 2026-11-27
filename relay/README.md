# @tada/relay

Cloudflare Worker + D1。前端（`web/dist`）和 API 同源部署在同一个 Worker 上。

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/v1/pair` | 配对码 | 一次性码换长期 token |
| POST | `/api/v1/sync/push` | Bearer token | 上传本地改动 |
| GET | `/api/v1/sync/pull?since=N&limit=500` | Bearer token | 按游标增量拉取 |
| GET | `/api/health` | 无 | 健康检查 |

请求/响应的类型定义在 `@tada/shared` 的 `src/api.ts`，校验 schema 在 `src/schemas.ts`。

### push

```json
{
  "changes": [
    {
      "entity": "lists",
      "id": "uuid",
      "hlc": "1760000000000-00001-dev1",
      "deleted": false,
      "data": {
        "name": "收件箱",
        "color": null,
        "orderKey": "a0",
        "createdAt": "2026-11-27T10:00:00.000Z",
        "updatedAt": "2026-11-27T10:00:00.000Z"
      }
    }
  ]
}
```

`deleted: true` 时不需要 `data`，服务端只把已有行标删，并同时刷新 `updated_at`。

push 响应里的 `lastSeq` **仅信息用途**：它是服务端当前最大的 seq，
**禁止把它当作 pull 游标**。拉取游标只能来自 pull 响应的 `nextSince`。

请求体上限 2,000,000 字节，超过返回 `413 {"error":"payload too large"}`；
空 body / 非法 JSON 返回 `400 {"error":"invalid json"}`。

### pull

```json
{
  "changes": [{ "entity": "lists", "id": "…", "hlc": "…", "deleted": false, "data": { … } }],
  "nextSince": 42,
  "hasMore": false
}
```

客户端保存 `nextSince`，下次带上；`hasMore` 为 `true` 时立刻再拉一次。

`since` / `limit` 只接受有限数字：`since` 负值或非数字按 0，`limit` 夹在 1–1000
（`limit=0` 会被夹到 1，而不是回退到默认值 500）。

**客户端分页兜底规则（必须实现）**：

1. 游标只前进不后退：`since = max(since, nextSince)`。
2. 一页返回的行数 `>= limit` 时，即使 `hasMore` 为 `false` 也要再拉一页；
   只有空页或不足一页时才停止。这是对服务端 `hasMore` 判断出错时的兜底。
3. 若 `nextSince` 没有变大，立即停止，避免死循环。
4. 每页拉完就落盘游标，中途断网重来不会重复拉取。

## 部署

在仓库根目录：

```bash
npx wrangler login
cd relay && npx wrangler d1 create tada   # 把 database_id 填进 wrangler.toml
cd ..
npm run db:init    # 建表
npm run deploy     # 构建前端 + 部署 Worker
```

### 升级旧库

`relay/schema.sql` 里的 `pairing_codes.claim_id` 是后加的列，而
`CREATE TABLE IF NOT EXISTS` 不会给已存在的表补列。按库的新旧分两种情况：

- **全新 D1**（还没建过表）：直接执行上面的 `npm run db:init`。
- **用上一版 schema 建的 D1**（已有 `pairing_codes`，但没有 `claim_id` 列）：
  先补列，再跑一次建表（幂等，不会重建已有表）：

  ```bash
  cd relay
  npx wrangler d1 execute tada --remote --command \
    "ALTER TABLE pairing_codes ADD COLUMN claim_id TEXT"
  cd ..
  npm run db:init
  ```

### APP_ORIGIN

`wrangler.toml` 的 `APP_ORIGIN` 用于跨源请求的 CORS 白名单：

- 前端与 API 同源部署（上面的默认方式）：浏览器不发 CORS 预检，占位值可以保留。
- 自定义域名，或开发时前端跨源访问 Worker：填实际的前端来源（例如
  `https://todo.example.com`），否则跨源请求会被浏览器拒绝。

## 配对一台设备

```bash
npm run pair
# 输出配对码，以及把它写进远端 D1 的命令；复制执行那条 wrangler 命令

curl -X POST https://<你的地址>/api/v1/pair \
  -H 'content-type: application/json' \
  -d '{"code":"A1B2C3D4E5","deviceName":"iphone-15"}'
# → {"token":"…"}
```

token 只在客户端保存，服务端只存 SHA-256。撤销：

```bash
cd relay
npx wrangler d1 execute tada --remote --command \
  "UPDATE devices SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = 'iphone-15'"
```

## 设计约定

- **LWW**：同一行以 `hlc` 较大者为准，旧的直接丢弃。单人使用足够。
- **墓碑删除**：删除是 `deleted = 1`，永不物理删除，否则另一端会把它复活。
- **配对原子化**：消费配对码与创建设备在同一个 D1 batch（事务）里，失败整体回滚。
- **API 不缓存**：所有 `/api/*` 响应带 `Cache-Control: no-store`；未知 `/api/*` 返回 404 JSON，不会落到 SPA。
- **seq 空洞无害**：每个改动先抢一个 seq；被 LWW 丢弃的写入也会消耗序号，所以 seq 不连续是正常的。
- **客户端需合并 create+delete**：离线期间新建又删除的行，在 outbox 里直接抵消，不要推送。
- **校验只增不减**：zod 对未声明字段是 strip 而非报错，新服务端不会打死旧客户端。

## 开发

```bash
npm run dev -w @tada/relay    # wrangler dev，127.0.0.1:8787
npm run dev -w @tada/web      # Vite，5173，/api 代理到 8787
```

本地建表：`npm run db:init:local -w @tada/relay`。
