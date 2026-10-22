# 楹雾镇网站

楹雾镇 Minecraft 社区官网、资源管理中心、互动小镇地图和后台管理系统。

正式域名：`https://moesam.com`；博客：`https://blog.moesam.com`。更换域名部署时，同步更新 DNS、Nginx `server_name`、HTTPS 证书和生产环境的 `VITE_API_URL` / `WEB_ORIGIN`，以及认证服务中的站点地址与回调白名单。

前端使用 React、Vite 与 TypeScript，登录、数据和文件存储由 Supabase 提供；需要服务端权限的账号管理由 Fastify API 提供。

## 本地启动

1. 在 Supabase 创建项目并执行 `supabase/migrations/` 内的迁移。
2. 复制 `.env.example` 为 `.env`，填写 Supabase URL、Anon Key 和服务端 Service Role Key。
3. 安装依赖并启动：

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动前端与 Fastify。前端默认运行于 `http://localhost:5173`，API 默认运行于 `http://localhost:8787`；如需单独启动，可使用 `pnpm dev:web` 或 `pnpm api:dev`。需要 Node.js 22.22 或更高版本。

## 权限

- `Viewer`：登录后查看小镇地图、材料互助和留言论坛
- `Member`：拥有 Viewer 权限，使用资源中心，创建地图认领、材料互助项目和论坛文本
- `Admin`：拥有 Member 权限，并管理地图、所有认领和地图标记
- `Owner`：拥有全部地图权限，并管理文案、图片、成员、FAQ、历史和后台账号

权限由 Supabase RLS 与 Fastify API 共同执行，不能通过修改前端绕过。
生产环境应在创建首个 Owner 后关闭 Supabase Auth 的公开注册。自助注册只允许通过
Fastify 的 QQ 验证流程进行，Owner 仍可从后台创建账号。具体位置与顺序见 Ubuntu 24
部署文档。

## GitHub Actions

推送到 `main` 或创建 Pull Request 后，`.github/workflows/ci.yml` 会执行类型检查、
单元/集成测试、生产依赖审计、Playwright 烟雾测试和生产构建。正式站点只通过
Ubuntu/Nginx 发布，GitHub Actions 不再部署 GitHub Pages。

在仓库的 Actions secrets 中添加以下变量，CI 才能验证生产构建；Ubuntu 正式环境仍从
`/etc/yingwu/yingwu.env` 读取生产变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`（部署 Fastify 后填写）

Fastify、React 构建和地图切片 API 统一部署到 Ubuntu 24 服务器。地图上传依赖
`sharp`/libvips，并通过 multipart 流式接收小于 50MB 的 PNG、JPG、WEBP 或 TIFF 图片。

## 数据库升级

本版本为 `v1.9.0`。不要手工挑选 SQL 文件；使用 Supabase CLI 按顺序应用全部
尚未执行的迁移：

```bash
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
```

部署时必须按文件名顺序应用 `supabase/migrations/` 中的全部迁移。不要依赖文档中手写的“最新迁移”文件名；
请以 `supabase migration list --linked` 与 `supabase db push --linked --dry-run` 的结果为准。v1.6.0 收紧公开注册、媒体读取、资源字段、
地图替换事务、论坛分页和补偿队列，并统一异步错误与交互状态。QQ 注册迁移在私有 schema 中增加身份与验证码挑战，
并以三次失败锁定、原子核销和未完成注册门禁保护自助注册；
此前的 v1.3.0 迁移新增首页历史与公告管理、网页数据统计、
材料快速认领和资源后台管理，并收紧共享资源的数据库修改边界。

站点文案、成员、历史、媒体、FAQ 与公告仅从 Supabase 读取，仓库不再保存生产内容快照。

## 检查

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm build
pnpm audit --prod
```

## Ubuntu 24 部署

完整的 Nginx、systemd、HTTPS、更新及回滚步骤见
[`docs/DEPLOY_UBUNTU_24.md`](docs/DEPLOY_UBUNTU_24.md)。
