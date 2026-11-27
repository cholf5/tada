# 第五轮：配对重放修复 + HTTP 层 E2E

仓库 `~/dev/cholf5/tada`。这是开发链的最后一轮，做完进入终检。

## P14 配对码同毫秒重放（中）

**问题**：`relay/src/store.ts` 的 `consumePairingCode` 在同一个 batch 里先 UPDATE 再 INSERT。若两次请求的 `now` 相同：
- 第 1 次：UPDATE 命中（used_at = T），INSERT 的 `WHERE code=? AND used_at=T` 命中，插入设备 1。
- 第 2 次：UPDATE 影响 0 行；但 INSERT 的 `WHERE ... used_at=T` 仍然命中，插入设备 2。
- 代码随后检查 `consumed.changes !== 1` 返回 null，但 batch 已提交，无法回滚 → 留下一条孤儿 devices 记录。

**要求**：
1. `relay/schema.sql` 的 `pairing_codes` 增加 `claim_id TEXT`（可空）。
2. `consumePairingCode` 每次请求生成唯一 claim（`crypto.randomUUID()`）：
   - `UPDATE pairing_codes SET used_at = ?now, claim_id = ?claim WHERE code=? AND used_at IS NULL AND expires_at > ?now`
   - `INSERT ... SELECT ... FROM pairing_codes WHERE code=? AND claim_id=?claim`
3. 两个语句仍在同一个 `db.batch()`。
4. `store.test.ts` 增加用例：用相同的 `now` 连续调用两次，第二次必须返回 null，且 `devices` 表只有 1 行。
5. 变异验证：把 INSERT 的 `claim_id=?claim` 条件去掉（改回 `used_at=?now`），该用例必须变红。
6. 注意：若本地已有旧的 D1 数据，schema 变更需要 `ALTER TABLE pairing_codes ADD COLUMN claim_id TEXT` 或重新 init；在交付说明里写清楚。

## E2E：真实 HTTP + 真实 D1（本地）

**目的**：`worker.test.ts` 至今用 `DB: {}`，HTTP 层与 SQL 的拼装从未一起跑过。用 `wrangler dev --local` 做一次真实闭环。

**步骤**（全部本地，不部署、不碰线上）：
1. `npm run build`（保证 `web/dist` 存在，wrangler assets 目录可用）。
2. 在 `relay/` 下启动 `npx wrangler dev --local --port 8787`，后台运行并等待就绪。
3. 对本地 D1 应用 `schema.sql`，插入一个配对码（10 位十六进制，如 `AAAA111111`，10 分钟有效）。
4. 用 curl 验证：
   - `GET /api/health` → 200 `{"ok":true}`
   - `POST /api/v1/pair` 正确码 → 200 且返回 token
   - 用同一码再 pair → 401
   - `POST /api/v1/sync/push` 带 Bearer 推一条 list → 200，`lastSeq` 递增
   - `GET /api/v1/sync/pull?since=0` → 返回刚才那条，字段完整
   - 用同一个 id、更高 hlc 再 push → pull 返回新值（LWW）
   - 用更低的 hlc 再 push → pull 不返回旧值（被丢弃）
   - 无 token / 错 token → 401
   - `GET /api/v1/nope` → 404 JSON
   - `POST /api/v1/pair` 非法 JSON → 400
   - `POST /api/v1/sync/push` 超过 2MB → 413
5. 结束后关掉 wrangler dev 进程。
6. 完整输出写 `/tmp/tada5-e2e.log`，交付里只给每条的 pass/fail。

若 `wrangler dev --local` 因 `database_id = REPLACE_ME` 无法启动，不要改线上配置；可在本地用 `--local` 允许的方式处理，或临时把 database_id 换成一个合法的 UUID 占位并在交付说明里注明（不要保留到最终交付）。

## 边界

- 可以改 relay / shared / web；不改端点路径与 wire 字段（`claim_id` 只在服务端库内部）。
- 不执行 `wrangler deploy`、`d1 create`、任何联网部署。
- 不改 docs/SPEC.md 验收标准。
- 不放宽断言。

## 验收

```bash
cd ~/dev/cholf5/tada
npm run typecheck > /tmp/tada5-typecheck.log 2>&1
npm run test      > /tmp/tada5-test.log 2>&1
npm run build     > /tmp/tada5-build.log 2>&1
```

三条 exit 0。交付里给出：变更清单、P14 完成情况、变异验证结果、E2E 逐条 pass/fail 与日志路径、测试统计、以及任何未能验证的项。
