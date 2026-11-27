# 交付加固记录

本轮按复核清单处理了同步可靠性、本地数据耐久、依赖与测试护栏；部署相关配置未动。

## 变更

### 同步

- `relay/src/e2e.test.ts`：HTTP 层 + 真实 `node:sqlite` 的闭环测试。覆盖配对重放、两台客户端 push/pull、LWW、墓碑、分页、401、非法请求。
- `relay/src/test/sqlite.ts`：把真实 SQLite 适配器抽出来，供 store 测试与 E2E 复用。
- 配对后首次全量 pull 使用 `fromStart`；中途失败重试会从 0 重新收集 `seenIds`，不会把前几页的行误判为「服务端没有」而重复补推。
- 远端新版本覆盖本地后，同时清理同一行过期的 `quarantine` 记录；设置页的「N 条数据不合法」不会再永久残留。
- 配对时清理过期超过一天的配对码；鉴权成功时最多每小时刷新一次 `devices.last_seen_at`。

### 本地数据

- 启动时申请 `navigator.storage.persist()`，设置页显示结果。
- 设置页新增「本地数据 → 导出备份」：JSON 快照包含列表与任务（含墓碑），不含配对 token。
- 数据库打开加 15s 超时，被其他标签页阻塞时给出可读错误；监听 `versionchange`，关闭旧连接并刷新。
- 根组件加 `ErrorBoundary`，渲染异常不再白屏。
- 行内重命名：任务行「更多 → 重命名」，Enter 保存、Esc 取消；标题单击仍打开详情。
- iOS 主屏安装补上 `apple-mobile-web-app-capable` 等 meta。

### 依赖与清理

- zod 3 → 4.6.7（修复 GHSA-mrhx-c7xc-m3w5）。
- vitest 3 → 4.1.12（修复 dev 链上的 critical / moderate 告警）。
- relay 显式依赖 `@types/node`，`tsconfig` 同时加载 Workers 与 Node 类型。
- 删除未使用的 `meta.seeded`、`formatDoneAt`；服务端 `devices.last_seen_at` 已开始维护。

## 验证

```bash
npm run typecheck   # exit 0
npm run test        # 24 + 61 + 98 = 183 个用例
npm run build       # exit 0，生成 manifest / sw.js
npm audit --omit=dev # 0 vulnerabilities
```

浏览器侧（无头 Chrome + 本地 wrangler D1，临时环境已清理）：

- 创建列表、任务、备注、子任务、截止日期、级联完成、搜索、今天视图
- 鼠标拖拽排序后只有被移动行的 `orderKey` 变化
- 设备 A 配对空服务器并全量上传；设备 B 全新配对后拉到全部数据
- B 新建 → A 同步可见；B 删除 → 服务端写墓碑，A 同步后消失
- 撤销 B 的 token → B 显示「凭证失效，请重新配对」，本地数据保留
- 生产构建停掉服务器后断网重载 → 应用壳与本地数据仍可用

## 仍未处理

- **部署**：`relay/wrangler.toml` 的 `database_id` 与 `APP_ORIGIN` 仍是占位符（按要求不部署）。
- **导入恢复**：只提供了导出；从 JSON 恢复需要手工处理，不在 v1 验收内。
- **真机验证**：触摸长按拖拽、iOS 主屏安装、Safari 上的 30s 请求超时尚未在真实设备上跑过。建议按下面的清单过一遍。
- **dev-only 告警**：`vite-plugin-pwa` / `workbox-build` / `minimatch` 仍有 4 个 moderate，属于构建期。上游暂无可用修复（审计只建议降级到 1.1.0），未降级。

## 真机验收清单

1. iPhone Safari 打开 → 分享 → 添加到主屏幕 → 从主屏启动，确认无浏览器地址栏。
2. 手机列表页长按任务手柄约 220ms 后拖动，确认页面不跟着滚动。
3. 侧栏列表长按拖动排序，松手后确认只有被移动列表的位置变化。
4. 飞行模式下改一条任务、重载页面，确认修改仍在；恢复网络后确认另一台设备收到。
5. 设置 → 本地数据 → 导出备份，确认下载的 JSON 能打开且不含 token。
