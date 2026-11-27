# 从零部署 Tada 到 Cloudflare Workers

这份教程从一台干净的电脑开始，到最后手机能安装、两台设备能同步。

全程只需要一个 Cloudflare 账号，不需要自己的服务器、域名或证书。前端也不需要单独托管：`npm run deploy` 会把 `web/dist` 和 API 一起发到同一个 Worker。

```
浏览器 / PWA ──HTTPS──> Cloudflare Worker ──> D1
                          ├─ /api/*          （配对、同步、品牌）
                          └─ web/dist        （前端静态文件）
```

部署完成后你会得到一个形如 `https://tada-relay.<你的子域>.workers.dev` 的地址：

- 打开就是 Tada 前端
- `/api/*` 是同步接口
- 可以添加到手机主屏，离线也能打开
- 数据存在你自己的 D1 里，不经过作者或第三方的应用服务器

> 一个 Worker 只服务一个人。不要把地址和配对码发给别人；朋友想用，让他们各自部署一份。

---

## 0. 先确认环境

需要：

- Cloudflare 账号（Free 计划够用）
- Node.js ≥ 24（`node -v` 应显示 `v24.x` 或更高）
- Git
- 一台能打开浏览器的电脑（登录 Cloudflare 用）

检查：

```bash
node -v
git --version
```

---

## 1. 拿到代码并安装依赖

```bash
git clone https://github.com/cholf5/tada.git
cd tada
npm install
```

可选：先看一眼前端。这个模式不需要中继，纯本地就能用：

```bash
npm run dev:web
```

打开 <http://localhost:5173>，确认界面正常，然后按 `Ctrl+C` 停掉。

---

## 2. 登录 Cloudflare

在仓库根目录：

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页，选账号并允许。回到终端后验证：

```bash
npx wrangler whoami
```

能看到账号名和邮箱，说明登录成功。

> 没有浏览器的服务器可以用 `CLOUDFLARE_API_TOKEN` 代替登录，token 需要 Workers 和 D1 的编辑权限。个人电脑部署直接用 `wrangler login` 更简单。

---

## 3. 创建 D1 数据库

仓库不提交 `relay/wrangler.toml`（数据库 ID、域名这些属于本机配置），只提交模板 `relay/wrangler.toml.example`。先复制一份：

```bash
cd relay
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create tada
```

输出里会有一段类似这样的配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "tada"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把其中的 `database_id` 复制到 `relay/wrangler.toml`，替换掉 `REPLACE_ME`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "tada"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

> **只替换 `database_id`，不要动 `binding`。** 新版 wrangler 的 `d1 create` 输出里，绑定名默认是数据库名（`binding = "tada"`），照抄会让 Worker 拿不到数据库：页面能打开，但配对和同步都返回 HTTP 500。代码固定读取 `env.DB`，所以配置里必须保持 `binding = "DB"`。

然后回到仓库根目录：

```bash
cd ..
```

检查点：

- `database_name` 和你创建时用的名字一致
- `database_id` 已经不是 `REPLACE_ME`
- 如果提示数据库已存在，说明这个账号建过；去 Cloudflare 控制台的 D1 页面复制已有 ID 即可，不要重复创建

> 这个 ID 不是密钥，但它属于你的账号。如果要给上游仓库提 PR，记得还原成 `REPLACE_ME`。

---

## 4. 建表

在仓库根目录：

```bash
npm run db:init
```

它实际执行的是 `wrangler d1 execute tada --remote --file=./schema.sql`（工作目录是 `relay/`）。

看到 `Executed N queries` 之类的输出、没有报错即可。

这个命令可以重复执行：`CREATE TABLE IF NOT EXISTS` 和 `INSERT OR IGNORE` 不会破坏已有数据。

> 升级时如果 `schema.sql` 新增了列，`CREATE TABLE IF NOT EXISTS` 不会自动补列。遇到旧库升级，按 [`relay/README.md`](../relay/README.md) 的「升级旧库」处理。

---

## 5. 部署

在仓库根目录：

```bash
npm run deploy
```

它做两件事：

1. `npm run build`：把前端构建到 `web/dist`
2. `wrangler deploy`：上传 Worker 脚本、`web/dist` 静态资源和 `wrangler.toml` 里的绑定

第一次部署可能会让你注册一个 `workers.dev` 子域，按提示选一个即可。最后输出里会有访问地址，形如：

```text
https://tada-relay.<你的子域>.workers.dev
```

打开这个地址，应该能看到 Tada 的界面。

### 验证

```bash
curl https://tada-relay.<你的子域>.workers.dev/api/health
```

应返回：

```json
{"ok":true}
```

再确认：

- 首页能打开，不是 404 或空白
- `https://.../manifest.webmanifest` 返回 JSON
- 手机浏览器打开同一地址，能看到「添加到主屏幕 / 安装应用」

---

## 6. 配对第一台设备

配对码是**一次性**的，**10 分钟内有效**。

1. 在仓库根目录生成配对码：

```bash
npm run pair
```

输出类似：

```text
配对码: A1B2C3D4E5   （10 分钟内有效，只能用一次）

把它写进线上数据库（在仓库根目录执行）：

  npx wrangler d1 execute tada --remote --config relay/wrangler.toml --command "INSERT INTO pairing_codes ..."
```

2. 复制最后那条 `npx wrangler ...` 命令执行。如果 wrangler 问是否继续，输入 `y`。
3. 打开部署好的地址，进入「设置 → 中继」。
4. 输入配对码和设备名（默认会从浏览器推断，可以改），点击连接。
5. 连接成功后会自动做一次全量拉取，状态变成「已同步」。

> 每台设备都要单独生成一个配对码。码过期或已经用过，就重新运行 `npm run pair`。

---

## 7. 安装到主屏

- **iPhone / iPad**：Safari 打开 → 分享 → 添加到主屏幕
- **Android**：Chrome 打开 → 菜单 → 安装应用 / 添加到主屏幕
- **桌面 Chrome / Edge**：地址栏右侧的安装图标

首次安装需要联网，让 Service Worker 把应用壳缓存下来。装好后：

- 从主屏启动，没有浏览器地址栏
- 飞行模式下打开，页面和已加载的数据仍在
- 恢复网络后，改动会自动同步

> 如果换过自定义域名，PWA 的身份会跟着 origin 变。确定长期使用的域名后再安装，避免旧入口的本地数据留在另一个 origin。

---

## 8. 第二台设备和验证

重复第 6 步，为第二台设备生成**新的**配对码。

验证同步：

1. 在 A 设备新建一条任务
2. 等 1 秒左右（客户端有防抖），切到 B 设备
3. B 设备切回前台或下拉刷新，应该能看到
4. 飞行模式下在 A 改一条任务，重载页面确认修改还在；恢复网络后 B 能看到

---

## 9. 日常更新

```bash
git pull
npm install
npm run db:init    # 建表是幂等的；有新表或迁移时跑
npm run deploy
```

- 现有设备的 token 不会失效，不需要重新配对
- 已安装的 PWA 通过 Service Worker 自动更新；没看到新版就完全关闭再打开
- 升级前建议在「设置 → 本地数据」导出一次 JSON 备份

---

## 10. 可选：自定义域名

`*.workers.dev` 已经自带 HTTPS，够用。如果想要自己的域名：

1. 把域名接入 Cloudflare（NS 指向 Cloudflare）
2. Dashboard → Workers & Pages → `tada-relay` → Settings → Domains & Routes
3. Add custom domain，填 `todo.example.com`
4. 等证书状态变成 Active，打开 `https://todo.example.com`

说明：

- 前端和 API 仍然在同一个 Worker 上，同源，不需要改 `APP_ORIGIN`
- 换域名等于换一个 PWA origin；旧入口的本地数据和安装记录不会自动迁移
- 只有把前端放到**另一个源**（比如 GitHub Pages）时，才需要把 `APP_ORIGIN` 设成那个前端的来源，并重新 `npm run deploy`

---

## 11. 可选：实例品牌

配对后在「设置 → 实例品牌」可以改应用名和图标。中继只保存一张 512×512 PNG，所有连接的设备刷新后生效。

- 已添加到主屏的 PWA 需要删除后重新添加，名称和图标才会更新
- 未配对时也可以在 `relay/wrangler.toml` 的 `[vars]` 里设置 `APP_NAME`，然后重新 `npm run deploy`
- 设置页保存过之后以 D1 里的品牌为准，再改 `APP_NAME` 不会覆盖

---

## 12. 备份与撤销设备

客户端备份：

- 「设置 → 本地数据」→ 导出 JSON 备份
- 备份包含列表和任务（含删除墓碑），不包含配对 token
- 导入恢复尚未实现

撤销丢失设备的 token（在 `relay/` 目录执行）：

```bash
cd relay
npx wrangler d1 execute tada --remote --command \
  "UPDATE devices SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = 'iphone-15'"
```

撤销后，该设备下一次请求会收到 401，并退回「未配对」；它本地已有的数据会保留。

---

## 13. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `Couldn't find a D1 DB with the name or binding 'tada'` | 在仓库根目录直接跑了 `wrangler d1 ...`，没找到配置 | 用 `--config relay/wrangler.toml`，或先 `cd relay` |
| `database_id` 还是 `REPLACE_ME` | 没替换 | 回到第 3 步 |
| `Authentication error` / `Not logged in` | 没登录，或登录过期 | `npx wrangler login` |
| 部署到了错误的 Cloudflare 账号 | 登录时选了别的账号 | `npx wrangler whoami` 确认；`npx wrangler logout` 后重新登录，或设置 `CLOUDFLARE_ACCOUNT_ID` |
| `no such table: lists` / `no such table: devices` | 没建表，或建到了本地库 | 在根目录 `npm run db:init`，确认它走的是 `--remote` |
| 首页 404 或空白 | 没构建，或部署时没上传 assets | 用 `npm run deploy`（它包含 build），看部署输出里有没有 assets |
| 页面能开，但 API 404 | 请求打到了别的域名或路径 | 单独访问 `/api/health` 确认 |
| 浏览器控制台报 CORS | 前后端不同源，`APP_ORIGIN` 不匹配 | 同源部署不需要；跨源时把 `APP_ORIGIN` 设为前端来源并重新部署 |
| 配对返回 HTTP 500，页面本身能打开 | `relay/wrangler.toml` 里的 `binding` 不是 `DB`（多半是照抄了 `d1 create` 输出的 `binding = "tada"`），Worker 里 `env.DB` 为空 | 把 `binding` 改回 `DB`，重新 `npm run deploy`；D1 里的数据不受影响 |
| 配对提示「无效或过期」 | 码超过 10 分钟、已经用过，或 SQL 没写进远端库 | 重新 `npm run pair`，确认命令带 `--remote`，再填 |
| 配对后一直 401 | 设备被撤销，或 token 被清掉 | 重新配对 |
| 主屏还是旧版本 / 旧图标 | Service Worker 缓存或 iOS 启动快照 | 完全关闭再打开；品牌变更需要删除后重新添加到主屏 |
| `Node.js` 版本报错 | Node 低于 24 | 升级 Node |
| `No such file: schema.sql` | 在错误的目录直接跑了 wrangler | 用仓库根目录的 `npm run db:init` |

---

## 14. 本地联调（可选）

不碰 Cloudflare，先在本地跑通同步：

```bash
# 终端 A：仓库根目录
cp relay/wrangler.toml.example relay/wrangler.toml   # 首次
npm run db:init:local
npx wrangler d1 execute tada --local --config relay/wrangler.toml --command \
  "INSERT INTO pairing_codes (code, expires_at) VALUES ('AAAA111111', strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))"
npm run dev:relay

# 终端 B：仓库根目录
npm run dev:web
```

打开 <http://localhost:5173>，在「设置 → 中继」填入配对码 `AAAA111111`，测试多端同步。

> 本地开发时 Service Worker 不会注册（代码里对 localhost 做了跳过），所以离线安装行为要在部署后的 HTTPS 地址上验证。

---

## 附：最短命令清单

```bash
git clone https://github.com/cholf5/tada.git
cd tada
npm install
npx wrangler login
cd relay
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create tada      # 把 database_id 填进 relay/wrangler.toml
cd ..
npm run db:init
npm run deploy
npm run pair                     # 执行打印出的 wrangler 命令，然后在设置里填配对码
```

部署完成后：

- 访问地址：`https://tada-relay.<你的子域>.workers.dev`
- 健康检查：`/api/health`
- 每台新设备：`npm run pair` → 执行命令 → 设置里填码
