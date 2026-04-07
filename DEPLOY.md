# mikujar 部署说明

## 架构

- **前端**：Vite + React，构建产物为静态文件。
- **后端**：`server/` 下 Express，提供：
  - `GET /api/collections` — 读取整棵合集树（JSON 数组），**公开只读**
  - `PUT /api/collections` — 覆盖保存（见下方鉴权）
  - `GET /api/auth/status` — `{ writeRequiresLogin }` 是否要求管理员登录才能写入
  - `POST /api/auth/login` — `{ password }` → `{ token }`（JWT）
  - `GET /api/auth/me` — 校验 `Authorization: Bearer <JWT>`
  - `GET /api/health` — 健康检查（含 `storage`、`mediaUpload`）
  - `POST /api/upload` — 管理员本地上传**任意类型文件**（仅受体积上限约束），写入 **COS** 或 `public/uploads/`（与 `PUT /api/collections` 相同鉴权）；返回的 `kind` 为 `image` / `video` / `audio` / `file`，前端仅对前三类做缩略图/播放器，其余以通用文件展示。
- **存储**：
  - **默认**：本地文件 `DATA_FILE`（未设置 COS 时，默认 `server/data/collections.json`，生产可挂卷到 `/data/collections.json`）。
  - **腾讯云 COS**：在服务端同时配置 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION` 后，`GET/PUT /api/collections` 改为读写对象存储中的 JSON（见下表 `COS_KEY`），无需在容器内持久化数据盘（仍建议配置管理员密码保护 `PUT`）。
  - **附件本地上传**：管理员在卡片菜单「本地上传到 COS / 本地上传」可选任意文件；由 `POST /api/upload` 保存并返回 URL。**已配置 COS 时**对象上传到桶内前缀 `COS_MEDIA_PREFIX`（默认 `mikujar/media/`）；**未配置 COS** 且存在 `server/public` 时落在 `public/uploads/`。轮播区对图片/视频/音频有专门缩略与预览，其它类型显示为文件卡片并可「在新窗口打开」。开发时 Vite 会将 `/uploads` 代理到后端。

本地修改后约 **0.9s** 防抖自动 `PUT`（仅在「可写」身份下：未启用管理员门闩，或已登录管理员）。首次若服务端返回空数组，会沿用内置示例并在首次保存时写入服务器。

**管理员与观众**：服务端同时设置 `ADMIN_PASSWORD` 与 `JWT_SECRET` 后，观众无需登录即可 `GET` 浏览；编辑与保存需在前端侧栏「管理员登录」输入密码，会话内使用 JWT（`sessionStorage`）。未配置这两项时，行为与旧版一致：所有人可写（开发环境），或仅依赖 `API_TOKEN` 保护 `PUT`。

## 本地联调

终端 1：

```bash
cd server && npm install && npm run dev
```

终端 2（根目录）：

```bash
npm install && npm run dev
```

Vite 会把 `/api` 与 `/uploads` 代理到 `http://127.0.0.1:3002`（本地上传的静态文件）。

**PostgreSQL 已有库升级**（`hint`、星标、回收站表）：在 `**server` 目录**执行，无需安装 `psql`：

```bash
cd server && npm run db:migrate
```

脚本读取 `server/.env` 中的 `DATABASE_URL`（与 `PG_SSL`），幂等可重复跑。

（可选）若服务器已安装 `psql`，仍可用等价 SQL 文件：`server/scripts/add-collection-hint-column.sql`、`server/scripts/add-favorites-trash-tables.sql`。

**新库**：直接执行完整 `server/scripts/schema.sql` 已含上述结构，一般不必再跑 `db:migrate`。

### 不做历史迁移、只要往后能保存

若**没有**旧版 `collections.json` / COS 里的数据要导入，**不要运行** `npm run migrate`（`migrate-json-to-pg.js`）。只需：

1. **PostgreSQL** 可连：`server/.env` 里 `DATABASE_URL` 的**主机名**必须是「跑 Node 的那台机器」能解析的地址（例如 `127.0.0.1` 或云数据库公网/内网 IP），不要用仅在 Docker 网络里有效的容器名。
2. **表结构**：新库执行一次 `**server/scripts/schema.sql`**；若库较旧缺表/缺列，在 `server` 目录执行 `**npm run db:migrate**` 即可（与 JSON 迁移无关）。
3. **多用户生产**：配置 `JWT_SECRET`、`ADMIN_PASSWORD`（首次启动会建管理员账号）。
4. 启动 API + 前端，登录后合集若为空，前端会用内置示例并在**首次同步**时写入 PG。

## 生产：同一进程（静态 + API）

```bash
npm install
npm run build:deploy
cd server && npm install && npm start
```

浏览器访问 `http://localhost:3002`。数据文件在 `server/data/collections.json`（可先由 `npm run export:collections` 生成）。

## Docker

```bash
docker build -t mikujar .
docker run -p 3002:3002 -v mikujar-data:/data mikujar
```

**Railway / CI 构建失败：`Could not find the web assets directory: ./www`**

根目录 `npm run build` 结束后会跑 `postbuild`，默认执行 `npx cap sync`（把 `dist` 同步进 iOS/Android 工程）。云端镜像往往**没有**拷贝 `capacitor.config.ts`，Capacitor 会退回默认目录 `www`，且部署 Web/API **根本不需要**同步原生壳。

- 使用本仓库 **Dockerfile** 时：已内置 `ENV SKIP_CAP_SYNC=1`，`postbuild` 会直接跳过。
- 若 Railway 用 **Nixpacks** 等方式只执行 `npm run build`：在 Railway 该服务的 **Variables** 里增加 `SKIP_CAP_SYNC=1`。

可选环境变量：


| 变量                                                         | 说明                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                     | 默认 `3002`                                                                                                                                                                                                                       |
| `DATA_FILE`                                                | JSON 路径，默认容器内 `/data/collections.json`                                                                                                                                                                                          |
| `ADMIN_PASSWORD`                                           | 与 `JWT_SECRET` 同时设置时启用管理员登录；`PUT` 需 JWT（或见 `API_TOKEN`）                                                                                                                                                                         |
| `JWT_SECRET`                                               | 签发/校验登录 JWT，生产请使用足够长的随机串                                                                                                                                                                                                        |
| `API_TOKEN`                                                | 可选静态 Bearer：在启用管理员模式时仍可用于脚本调用 `PUT`；未启用管理员时仅保护 `PUT`（`GET` 始终公开）                                                                                                                                                                |
| `CORS_ORIGIN`                                              | **分域 / 浏览器跨域访问 API 时必填**（逗号分隔允许的前端 Origin）。未设置时**不**允许任意站跨域；同源部署或仅 curl 不受影响                                                                                                                                                    |
| `TRUST_PROXY`                                              | 设为 `1` 时信任 `X-Forwarded-For`（反代后登录限流按真实 IP）                                                                                                                                                                                     |
| `AUTH_COOKIE_DOMAIN` / `COOKIE_SAMESITE` / `COOKIE_SECURE` | httpOnly 登录 Cookie；子域跨站 API 时常需 `AUTH_COOKIE_DOMAIN=.父域`、`COOKIE_SAMESITE=none` 且 HTTPS 下 `COOKIE_SECURE=true`                                                                                                                  |
| `AUTH_HTTPONLY_COOKIE`                                     | 设为 `false` 可关闭登录 Set-Cookie（不推荐）                                                                                                                                                                                                |
| `COS_SECRET_ID`                                            | 腾讯云 API 密钥 SecretId；与下面三项同时设置即启用 COS 存储                                                                                                                                                                                         |
| `COS_SECRET_KEY`                                           | 腾讯云 API 密钥 SecretKey                                                                                                                                                                                                            |
| `COS_BUCKET`                                               | 存储桶名称，格式如 `bucketname-1250000000`（含 APPID）                                                                                                                                                                                      |
| `COS_REGION`                                               | 地域，如 `ap-guangzhou`、`ap-beijing`、`ap-shanghai`                                                                                                                                                                                  |
| `COS_KEY`                                                  | 可选，合集 JSON 的对象键，默认 `mikujar/collections.json`                                                                                                                                                                                   |
| `COS_MEDIA_PREFIX`                                         | 可选，附件对象键目录前缀，默认 `mikujar/media`（勿以 `/` 结尾）                                                                                                                                                                                      |
| `COS_PUBLIC_BASE`                                          | 可选，附件公网访问基址（如 CDN `https://img.example.com`）；不设置且未开全球加速时，使用 `https://{Bucket}.cos.{Region}.myqcloud.com`                                                                                                                        |
| `COS_USE_ACCELERATE`                                       | 设为 `true` / `1` / `yes` 时，SDK 与公网 URL 使用全球加速域名 `https://{Bucket}.cos.accelerate.myqcloud.com`（须先在控制台为该桶启用全球加速，见 [全球加速说明](https://cloud.tencent.com/document/product/436/55590)）；与 `COS_PUBLIC_BASE` 同时配置时以 `COS_PUBLIC_BASE` 为准 |
| `UPLOAD_MAX_MB`                                            | 可选，单文件大小上限，默认 `100`，最大 `500`                                                                                                                                                                                                    |


COS 说明：在 [腾讯云控制台](https://console.cloud.tencent.com/cos) 创建存储桶后，为运行本服务的账号或子用户授予该桶的 **GetObject / PutObject**（及首次写入可能需要的权限）。附件上传使用 `**ACL: public-read`**，请确保桶未开启「禁止公共访问」或改为通过桶策略/自定义域名提供匿名读，否则浏览器无法直接加载图片/视频/音频 URL。密钥仅配置在**服务端**环境变量中，勿写入前端 `.env`。`GET /api/health` 的 JSON 里会带 `storage`（合集 JSON 存储）与 `mediaUpload`（`cos` / `local` / 未开放时为 `null`）便于确认当前能力。

启用管理员模式后，前端**无需**再配 `VITE_API_TOKEN`；若仍为旧部署（仅 `API_TOKEN`），构建前可在根目录 `.env` 设置 `VITE_API_TOKEN` 与服务器一致。

## 分域部署（前端 CDN / 另一域名）

构建时指定 API 根：

```bash
VITE_API_BASE=https://api.example.com npm run build
```

并配置 `CORS_ORIGIN` 为前端页面来源。

---

## GitHub + Vercel（前端）与腾讯云 1Panel（后端）

### 密钥填在哪里？（重要）


| 内容                                                | 填在哪里                                 | 是否进 GitHub                                 |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| **管理员密码** `ADMIN_PASSWORD`                        | **仅后端**（1Panel 里跑 Node/Docker 的环境变量） | **不要**提交到仓库                                |
| **JWT 签名** `JWT_SECRET`                           | **仅后端**                              | **不要**提交                                   |
| **腾讯云 API 密钥** `COS_SECRET_ID` / `COS_SECRET_KEY` | **仅后端**（同上）                          | **不要**提交                                   |
| **COS 桶信息** `COS_BUCKET`、`COS_REGION` 等           | **仅后端**                              | **不要**提交                                   |
| **前端 API 地址** `VITE_API_BASE`                     | **Vercel** 构建环境变量（见下）                | 可用 Vercel 控制台配置，**不要**把含密钥的 `.env` 推送到公开仓库 |


管理员登录密码、COS、JWT **全部是服务端逻辑**；前端只在浏览器里输入密码调用 `POST /api/login`，**仓库和 Vercel 里都不需要填管理员密码或腾讯云 Secret**。

### 腾讯云密钥从哪里拿？

1. 登录 [腾讯云控制台 → 访问管理 → API 密钥](https://console.cloud.tencent.com/cam/capi) 创建 **SecretId / SecretKey**（可建子用户并只授 COS 权限，更安全）。
2. [对象存储 COS](https://console.cloud.tencent.com/cos) 里创建存储桶，记下 **桶名称（含 APPID）**、**地域**（如 `ap-guangzhou`），填到后端的 `COS_BUCKET`、`COS_REGION`。

### 与机器上「已有后端」会冲突吗？

**默认会冲突的只有两种：** 同一台机、**同一个监听端口**（例如两个进程都占 `3002`），或 **同一条 Nginx/反代 `location` 抢同一路径**。  

可以这样**不冲突**地共存：

- **新开一个端口**：若 `3002` 已被占用，可把本项目的 `server` 改成 `**PORT=其他空闲端口`**，在 1Panel / 反代里用**另一个域名或路径**指到该端口（例如 `api.note.hejiac.com` → `127.0.0.1:3002`；与其它服务并存时确保每条反代对应不同端口）。  
- **或**把本仓库的 `/api` 逻辑合并进你现有后端（同一进程、统一路由），则不存在第二套 Node 抢端口的问题，但需要你自己接路由与存储。

前端只认 `**VITE_API_BASE` 指向的地址**；只要该地址能访问到本项目的 Express（`/api/collections` 等），与根域上别的网站、别的 API **互不干扰**。

### 在 1Panel（后端）里怎么填？

在 1Panel 中运行本项目的 `**server/`**（Docker 部署、Node 应用或「网站 → 反向代理到 Node」均可），在对应应用的 **环境变量** 中增加上表中的后端变量，例如：

- `ADMIN_PASSWORD`：你自己定的管理密码（强密码）。
- `JWT_SECRET`：随机长字符串（可用 `openssl rand -hex 32` 生成）。
- `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`：按上面腾讯云控制台填写。
- `CORS_ORIGIN`：浏览器里**实际打开前端**的完整来源（协议 + 域名），多个用英文逗号分隔。例如 Vercel 默认域 `https://xxx.vercel.app`；若前端绑定备案子域 `**https://note.hejiac.com`**，则必须写上 `https://note.hejiac.com`（不要漏 `https://`，不要路径）。根域 `hejiac.com` 已做别的站也没关系，子域 **note** 可单独指向本笔记前端。
- **Tauri 桌面版（macOS/Windows）**：打包后 WebView 的 `Origin` 常见为 `**https://tauri.localhost`**，少数环境会是 `**http://tauri.localhost**`（协议不同也算不同来源）。在 `CORS_ORIGIN` 里写上 `**https://tauri.localhost**` 即可；本仓库服务端会自动为 `**tauri.localhost` / `ipc.localhost**` 补全另一协议，避免只配 `https` 时桌面端仍被 CORS 拦。网页端与 Tauri 示例：  
`https://note.hejiac.com,https://tauri.localhost`  
`**tauri dev` / 浏览器直接跑 `npm run dev` 且前端直连线上 API（`VITE_API_BASE` 指向 `https://api.xxx`）时，浏览器发出的 `Origin` 是 `http://localhost:5173`（不是 `tauri.localhost`）。** 必须在 `CORS_ORIGIN` 里加上这一项，否则控制台会出现你截图里那种 CORS 报错。示例：  
`https://note.hejiac.com,https://tauri.localhost,http://localhost:5173`  
若仍失败，看开发者工具里失败请求的实际 `**Origin`**，原样追加进 `CORS_ORIGIN`。
- 若 API 对外域名不是根路径，只要整站都是这一个 Node 提供 `/api` 即可；`PORT` 与 1Panel 反代端口保持一致。

不要把含上述内容的文件提交到 Git；在 1Panel 界面里单独配置即可。

### 在 Vercel（前端）里怎么填？

1. 仓库只放 **前端源码**（或整仓但构建命令只构建前端）。
2. Vercel 项目 → **Settings → Environment Variables** 增加：
  - `**VITE_API_BASE`** = 你的后端公网地址，例如 `https://api.你的域名.com`（**不要**末尾 `/`）。
3. **Build command**：例如 `npm run build`，**Output directory**：`dist`（与 `vite.config` 一致）。
4. 重新部署一次，使 `VITE_API_BASE` 被打进静态资源。

**用备案子域当前端（例：`note.hejiac.com`）**  

- 在域名 DNS（腾讯云解析等）为 `**note`** 增加记录：若前端在 Vercel，一般填 Vercel 提供的 **CNAME**（如 `cname.vercel-dns.com`），按 Vercel 项目 → *Domains* 里说明操作。  
- Vercel 里把自定义域名 `**note.hejiac.com`** 加到该项目并等待证书生效。  
- 后端 `**CORS_ORIGIN**` 写上 `**https://note.hejiac.com**`（若同时保留 `vercel.app` 测试域，可写成逗号分隔的两项）。  
- API 仍可用另一子域或任意已部署地址；`**VITE_API_BASE**` 填该 API 根（**不要**末尾 `/`）。例如 `https://api.hejiac.com`，或把 API 归在笔记名下用 `**https://api.note.hejiac.com`**（在 DNS 里主机名一般为 `**api.note**`，指向你反代/服务器的 A 或 CNAME；证书用 1Panel / Let’s Encrypt 为该主机名单独申请即可）。

本地可参考根目录 `.env.example`：分域时只用到 `VITE_API_BASE`（及旧版才需要的 `VITE_API_TOKEN`）。

### 流程小结

1. 腾讯云 1Panel 上后端跑起来，环境变量配好 **ADMIN_***、**JWT_***、**COS_***、**CORS_ORIGIN**。
2. 浏览器访问后端 `https://你的API域名/api/health` 应返回 JSON。
3. Vercel 配好 `**VITE_API_BASE`** 指向上一步的 API 根（协议 + 域名，无路径后缀）。
4. 用户打开 Vercel 站点 → 只读浏览；侧栏锁图标登录 → 使用你在 `**ADMIN_PASSWORD**` 里设的那串密码。

## 与 `src/data.ts` 同步示例数据

修改内置示例后执行：

```bash
npm run export:collections
```

会重写 `server/data/collections.json`。