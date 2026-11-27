# 第六轮：收尾修补

来源：review5 终检。仓库 `~/dev/cholf5/tada`。这是最后一个开发批次，做完即交付。

## P15 旧库迁移文档（中）

`relay/schema.sql` 的 `pairing_codes.claim_id` 是新列，`CREATE TABLE IF NOT EXISTS` 不会升级旧表。
- 在 `relay/README.md` 的部署步骤里加一条：仅当 D1 是上一版 schema 建的（已有 pairing_codes 但无 claim_id）才执行
  `ALTER TABLE pairing_codes ADD COLUMN claim_id TEXT`；全新库不需要。
- 同时说明 `APP_ORIGIN` 同源部署可留占位，自定义域名/跨源开发需填实际地址。

## P16 Node 版本（低）

根 `package.json` 的 `engines.node` 从 `>=22` 改为 `>=24`（测试依赖 `node:sqlite`，Node 22 需实验开关）。
在 README 的开发前提里写一句：Node ≥ 24。

## P17 quarantine 提示永不消失（低，但用户可见）

现状：4xx 毒丸被隔离后，即使之后修好并同步成功，设置页仍永久显示「N 条数据不合法，已跳过」。
- push 成功时删除本批涉及 key 的 quarantine 记录。
- 设置页增加「清除提示」按钮，手动清空 quarantine。
- 测试：隔离一条 → 修正后成功推送 → quarantine 为空、提示消失；手动清除也生效。

## P18 fetch 无超时（低，但会卡死同步）

`web/src/sync/api.ts` 的 fetch 没有超时。挂起请求会让引擎停在「同步中」，inflight 不释放。
- 所有请求加 `AbortSignal.timeout(30_000)`。
- abort 映射为可重试的临时错误（走现有退避），不要当成 401。
- 测试：模拟超时/abort 时抛出可重试错误，引擎进入退避而不是永久 syncing。

## P19 删除列表不给任务写墓碑（低）

删除列表后，其任务在服务端永久残留且不可见。
- 删除列表时，把该列表下所有未删除任务一起标记 deleted=1，并入 outbox 推墓碑（同一 Dexie 事务）。
- 测试：删列表后，该列表任务的墓碑进入 outbox，push 负载包含它们。

## P20 文档同步（低）

- `docs/SPEC.md`：把「取 outbox 最早 500 条」改为实际值 200，并注明服务端单请求上限 500。
- 数据模型补上 `remote` 字段、`quarantine` 表、meta 的 `lastHlc / lastSyncedAt / pairReseed`。
- 已知限制补：IndexedDB 中 token 为明文（同源 XSS 风险，已由 React 转义缓解）；每标签页独立 HLC 后缀，同毫秒跨标签由设备段字典序决胜。

## P21 误导注释（信息）

`web/src/sync/pull.ts` 里把 relay 分页写成「已知缺陷」，该缺陷已修复并有 store 测试；改为「防御旧版服务端」。

## P22 解除配对清 lastSeq（低）

`web/src/App.tsx` 解除配对时同时清 token 与 lastSeq，语义与 W6 一致（当前靠配对时重置，行为等价但不够显式）。

## 边界

- 可以改 relay / shared / web / docs；不改端点路径与 wire 字段。
- 不执行 wrangler deploy / d1 create。
- 不改 SPEC 的验收标准。
- 不放宽断言。

## 验收

```bash
cd ~/dev/cholf5/tada
npm run typecheck > /tmp/tada6-typecheck.log 2>&1
npm run test      > /tmp/tada6-test.log 2>&1
npm run build     > /tmp/tada6-build.log 2>&1
```

三条 exit 0。交付：变更清单、逐条完成情况、测试统计、仍未处理的事项（如有）。
