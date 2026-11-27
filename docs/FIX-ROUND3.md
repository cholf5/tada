# 第三轮修复清单

来源：review3 独立复核（变异验证 + 运行期探针）。仓库 `~/dev/cholf5/tada`。

## 必修（高）

### P1 lastHlc 从未落盘
- 现象：`bootstrap()` + `createList()` 后 `meta.lastHlc` 仍是 undefined；重新 bootstrap 后时钟水位归零。
- 根因：`web/src/db/repo.ts` 的 `ALL_TABLES` 与 `web/src/sync/pull.ts` 的事务 scope 都不含 `db.meta`；`persist()` 在事务内写 meta 抛 `NotFoundError`，被 `web/src/db/bootstrap.ts` 的空 catch 吞掉。
- 要求：
  - 把 `db.meta` 加入所有会触发 persist 的事务 scope（`ALL_TABLES`、pull 的 tables()，以及任何其他 `db.transaction` 调用点）。
  - 删掉空 catch，至少 `console.warn`。
  - 回归测试：真实 Dexie + fake-indexeddb 下 bootstrap → 写一条 → 断言 `meta.lastHlc` 有值；再次 bootstrap 后 `clock.next()` 大于历史值。

### P2 4xx 毒丸导致同步永久卡死
- 现象：任一条变更被 400（标题 >2000、备注 >20000、name >200）拒绝 → 整批 push 400 → outbox 永不清空，每秒重试。
- 要求：
  - 输入侧加限长，与 `@tada/shared` 一致：title 2000、notes 20000、list name 200；`maxLength` 属性 + repo 层防御。
  - 客户端处理 4xx：400 时逐条重试定位并隔离毒丸（新增 `quarantine` 表或 outbox 标记，UI 提示「N 条数据不合法，已跳过」），其余条目继续；413 时把批次拆小（50）重试，仍失败则逐条隔离；401 保持现有逻辑。
  - 测试：400 毒丸不影响同批其他条目、outbox 最终清空、状态不再 error 死循环；413 拆批。

### P3 退避恒为 1s
- 现象：`web/src/sync/engine.ts` 的 `attempt` 只被赋 0，从不自增。
- 要求：失败时 `attempt += 1` 后再计算退避；成功与 401 时归零。把退避延迟计算抽成纯函数并测试 1→2→4→…→60 上限。

## 必修（中）

### P4 413 发生在全量读入之后
- `relay/src/http.ts` 先用 `req.text()` 读完整 body 再判 2MB。
- 要求：先看 `content-length`，超限直接 413，不读 body；没有该头时用 `req.body` reader 累计字节，超限中止。测试覆盖两条路径。

### P13 配对到非空服务器时本地独有行不上传
- 现象：只有「服务器完全为空」才自动补推；把有本地数据的设备配对到非空服务器，本地独有行永远不上传。
- 要求：配对后首次全量 pull 完成时，比较本地 id 与服务端返回的 id 集合，把本地存在而服务端没有的行重新入 outbox 推送。设置页「重新上传本地数据」保留为手动兜底。测试覆盖。

## 顺手修（低，但要一起做）

- P6：只有 outbox 为空且没有 `again` 待续时才 publish('synced')。
- P8：渲染 color 前做 hex 白名单校验，非法值回退默认色（ListView / TaskRow / Sidebar）。
- P9：drop outbox 时显式判断 `outbox.hlc <= incoming.hlc`，不再只依赖不变式。
- P12：设备段保留「安装级 12 位 + 每标签页 5 位随机」；在 `docs/SPEC.md` 已知限制里写清楚它是每页变化，单调性由 lastHlc 持久化保证。

## 不在本轮

- P10 relay SQL 层测试（node:sqlite 或 D1 mock）→ 下一批
- P11 W17 红线测试 → 下一批
- P5 单批 1000 statement 上限 → 下一批，先加保险：单次 push 变更数上限降到 200

## 验收

```bash
cd ~/dev/cholf5/tada
npm run typecheck > /tmp/tada3-typecheck.log 2>&1
npm run test      > /tmp/tada3-test.log 2>&1
npm run build     > /tmp/tada3-build.log 2>&1
```

三条 exit 0；新增测试必须能在对应修复被回退时失败（自己至少做 2 处变异验证并写进报告）。
