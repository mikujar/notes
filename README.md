# 未来罐 · mikujar

一款以**时间线 + 合集**组织的笔记应用：横格纸风格正文、日历与搜索、图片/视频/音频附件、相关笔记、回收站与置顶。支持**网页**与 **Tauri 桌面端**，可选对接 **PostgreSQL** 多用户与 **腾讯云 COS** 附件存储。

---

## 功能概览

- **笔记**：Tiptap 富文本、标签、按时刻排序、详情弹窗内联播放音视频  
- **合集**：树形文件夹、拖拽排序、删除确认  
- **媒体**：轮播预览、全屏 lightbox、本地上传或 COS 直传  
- **账号**：用户登录、个人中心（昵称/密码/头像）、管理员拉新与管理台（视后端配置）  
- **数据**：远程 API 模式或本地模式；生产可 JSON 文件、COS 单文件，或 PostgreSQL 按用户分库

---

## 技术栈


| 层级        | 技术                              |
| --------- | ------------------------------- |
| 前端        | React 18、TypeScript、Vite、Tiptap |
| 后端        | Node.js、Express（`server/`）      |
| 可选桌面 / 移动 | Tauri 2                         |
| 可选数据库     | PostgreSQL（`server` 内迁移脚本）      |
| 可选对象存储    | 腾讯云 COS                         |


---

## 本地开发

**1. 启动 API（终端一）**

```bash
cd server && npm install && npm run dev
```

默认监听 `http://127.0.0.1:3002`（以 `server` 内配置为准）。

**2. 启动前端（终端二，仓库根目录）**

```bash
npm install && npm run dev
```

Vite 会将 `/api`、`/uploads` 代理到本地后端。

**3. 环境变量（可选）**

- 前端：根目录可参考 `.env.example`，常用 `VITE_API_BASE`（分域部署时指向线上 API）  
- 后端：见 `server` 内说明与 **[DEPLOY.md](./DEPLOY.md)** 中的变量表

---

## 生产构建与部署

一键把前端构建结果拷进 `server/public` 并由同一进程托管：

```bash
npm install
npm run build:deploy
cd server && npm install && npm start
```

Docker、COS、CORS、Vercel + 独立 API 等完整说明见 **[DEPLOY.md](./DEPLOY.md)**。

---

## 仓库结构（简要）

```
├── src/           # React 应用源码
├── server/        # Express API、存储与上传逻辑
├── scripts/       # 导出合集、构建辅助等
└── DEPLOY.md      # 部署与环境变量详解
```

---

## 相关命令


| 命令                                          | 说明                                      |
| ------------------------------------------- | --------------------------------------- |
| `npm run dev`                               | 前端开发服务器                                 |
| `npm run build`                             | 前端生产构建                                  |
| `npm run server:dev`                        | 后端 watch 模式                             |
| `npm run build:deploy`                      | 构建并同步到 `server/public`                  |
| `npm run export:collections`                | 将内置示例导出为 `server/data/collections.json` |
| `npm run tauri:dev` / `npm run tauri:build` | Tauri 开发与打包（需本机 Rust 环境）                |


---

## 许可证

若仓库根目录未单独放置 `LICENSE` 文件，默认以仓库所有者声明为准；二次分发前请自行确认授权条款。