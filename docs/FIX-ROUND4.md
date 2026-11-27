# 第四轮修复清单

来源：review3 的「不在本轮」项 + dev3 交付时的提醒。仓库 `~/dev/cholf5/tada`。

## P10 relay SQL 层测试（中）

**问题**：relay 的 34 个用例里，`worker.test.ts` 用 `DB: {}`，所有业务 SQL（push upsert、墓碑、pull 查询、配对事务）从未真正执行。上一轮变异证明：把分页的 `limit + 1` 改回 `limit`，31 个用例全绿。

**要求**：
1. 把 DB 操作抽到 `relay/src/store.ts`，接受一个最小 `D1Like` 接口（`prepare().bind().all()/first()/run()`、`batch()`）：
   - `pullPage(db, since, limit)`：两表各取 `limit+1`、合并、分页、返回 `changes/nextSince/hasMore`
   - `applyPush(db, changes)`：组装 batch、执行、返回 lastSeq
   - `consumePairingCode(db, code, deviceName, now)`：UPDATE + INSERT 同 batch
   - `findDeviceByTokenHash(db, hash)`
   `index.ts` 只保留路由、鉴权头解析、错误映射。
2. 在 `relay/src/store.test.ts` 里用 Node 内置的 `node:sqlite`（`DatabaseSync`）实现 D1Like 适配器，**加载真实的 `schema.sql`**，然后测：
   - 单表剩余 > limit 时 `hasMore === true`；恰好 limit 时 `false`
   - 跨表合并按 seq 有序、`nextSince` 正确
   - LWW：新 hlc 覆盖、旧 hlc 忽略、相等忽略
   - 墓碑：写 deleted=1、更新 updated_at、旧 hlc 墓碑无效、seq 推进
   - 配对：一次性码成功一次、重放失败、过期失败
   - 鉴权：撤销的 token 查不到
3. 不引入原生模块依赖（`node:sqlite` 是 Node 25 内置，禁止 better-sqlite3）。
4. 变异验证：把 `pullPage` 里的 `limit + 1` 改回 `limit`，新增测试必须变红。

## P11 W17 红线测试（中）

**问题**：把 push 响应的 `lastSeq` 写进 `meta.lastSeq`（正是红线禁止的行为），现有 63 个 web 用例全绿。

**要求**：
- 加一个 engine 测试：push 返回一个很大的 `lastSeq`（如 999），断言下一次 pull 的 `since` 仍等于 push 前的 `meta.lastSeq`，而不是 999。
- 变异验证：在 engine 的 push 成功分支加 `setMeta('lastSeq', pushRes.lastSeq)`，该测试必须变红。

## P5 单批上限保险（低）

**问题**：500 条变更 → 最多 1000 条 batch statement，超出 D1 保守上限时整批失败。

**要求**：
- `web/src/sync/push.ts` 单次取 outbox 的条数上限改为 200（常量导出），并确认循环会继续推送剩余条目。
- 补一条测试：outbox 有 450 条时，首轮取 200、最终全部清空。

## 边界与验收

- 可以改 relay / web / shared；不改端点路径与 wire 字段。
- 不执行 wrangler deploy / d1 create。
- 不改 docs/SPEC.md 的验收标准。

```bash
cd ~/dev/cholf5/tada
npm run typecheck > /tmp/tada4-typecheck.log 2>&1
npm run test      > /tmp/tada4-test.log 2>&1
npm run build     > /tmp/tada4-build.log 2>&1
```

三条 exit 0。报告里给出：
1. 变更清单
2. P10/P11/P5 完成情况
3. 两处变异验证的实际结果（A1 与 W17）
4. 测试统计（文件/用例）
5. 是否还有 relay 业务 SQL 没有被真实执行到
