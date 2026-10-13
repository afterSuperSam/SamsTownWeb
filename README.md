# 楹雾镇网站（SamsTownWeb）

Minecraft 社区展示、成员档案、历史、论坛、地图协作与账号管理平台。当前源码版本 `v2.0.0`。

源码仓库：[afterSuperSam/SamsTownWeb](https://github.com/afterSuperSam/SamsTownWeb)，生产站点：[yingwutown.top](https://yingwutown.top)。

## 架构

```text
浏览器 → Nginx → React 静态页面
              → /api、/health → Fastify → Supabase Auth / Storage
浏览器 → services / repository → Supabase Data API / RPC / Realtime（RLS 授权）
```

- React、TypeScript、Vite；Context 管理会话、语言与主题。
- Fastify 处理用户名登录、账号管理、地图上传、视频解析和访问统计。
- PostgreSQL 保存业务数据；RLS 和事务 RPC 执行权限及一致性规则。
- `pages/` 组合页面，`features/` 按功能域组织，`domain/` 保存纯逻辑，`services/` 保存数据访问。
- `components/` 提供共享按钮、通知、对话框、选择框、加载和媒体展示。视觉重构优先改这些组件与 CSS，页面不直接访问数据库。

| 页面 | 路径 | 能力 |
| --- | --- | --- |
| 首页 | `/` | 社区内容、风景、成员与联系方式 |
| 档案 | `/history` | 成员、历史与媒体 |
| 地图 | `/map` | 公开地图；登录后按角色认领和管理 |
| 账号 | `/account` | 用户名登录、账号和玩家资料 |
| 论坛 | `/forum` | 登录后查看，Member+ 发帖 |
| 后台 | `/admin` | Owner 管理内容、账号和统计 |

QQ 注册、验证码和绑定已从源码移除；新账号统一由 Owner 后台创建。公开 QQ 群和镇长联系方式继续保留。新账号首次登录必须更换临时密码。

## 使用与配置

要求 Node.js `>=22.22.0`、`pnpm@11.9.0`，精确依赖以 `package.json` 和 lockfile 为准。

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

`pnpm dev` 同时启动 Vite 与 Fastify；生产 API 由 `pnpm api:build` 编译，`pnpm api:start` 启动。

| 配置 | 用途 / 默认值 |
| --- | --- |
| `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` | 浏览器的项目地址和公开密钥 |
| `VITE_API_URL` | API 地址，本地默认 `http://localhost:8787`；生产使用同域地址 |
| `VITE_API_TIMEOUT_MS` | 浏览器请求超时，默认 `15000` |
| `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` | 仅 Fastify 使用的项目凭据 |
| `API_HOST`、`API_PORT` | 默认 `127.0.0.1:8787` |
| `WEB_ORIGIN` | 允许的浏览器来源，默认 `http://localhost:5173` |
| `API_TRUST_PROXY` | 默认 `false`；同机 Nginx 部署用 `loopback` |
| `API_BODY_MAX_BYTES` | 普通 JSON 大小上限，默认 1 MiB |
| `AUTH_RATE_WINDOW_MS` | 登录、改密和地图上传限流窗口，默认 15 分钟 |
| `AUTH_LOGIN_RATE_MAX`、`AUTH_PASSWORD_RATE_MAX` | 窗口内最多 10 次登录、5 次改密 |
| `MAP_UPLOAD_MAX_BYTES`、`MAP_UPLOAD_RATE_MAX` | 单张默认 50 MiB，窗口内最多 3 次上传 |
| `BILIBILI_REQUEST_TIMEOUT_MS` | 视频元数据请求超时，默认 10 秒 |
| `ANALYTICS_IP_PEPPER` | 可选统计密钥，至少 32 字符 |

当前新 Supabase 项目：`zqddeeljxwfkguqugucg`，区域 `ap-northeast-1`。已从旧项目 `hsbshnhtxplqecbhrirt` 导入保留功能的数据与账号；QQ 绑定、资源和材料数据按退役规则排除。Storage 已核对 `site-images` 9 个、`town-maps` 464 个对象，服务端 Secret 只保存在本机 `.env`。

服务端配置由 `server/config.ts` 校验；地图交互配置集中在 `atlasConfig.ts`。Storage 和 Auth 删除失败由现有补偿队列处理，配置见 `.env.example`。

未配置 Supabase 时公共页面可打开，业务列表为空；已配置项目的查询错误直接显示错误，不再兼容缺表、缺字段或旧 RPC。

## 验证

常规改动：

```powershell
pnpm check
pnpm lint
pnpm test
```

保留 **6 个 Vitest 文件、30 个用例**：API 鉴权和错误、上传安全与补偿、权限与几何、请求传输、地图分页、运维只读边界。浏览器只保留 **1 个文件、1 个公共导航冒烟场景**；不维护源码字符串契约、组件快照、历史版本回归或覆盖率门槛。当前视觉巡检覆盖桌面首页、390px 移动首页、档案页、导航菜单、主题切换和画廊／成员／历史区块，并确认没有横向溢出。

共享控件变化时执行 `pnpm test:e2e`。数据库迁移变化时可在本机 PostgreSQL 运行唯一隔离夹具：

```powershell
$env:PG_BIN_DIRECTORY = 'C:/Program Files/PostgreSQL/16/bin'
node tests/retirement-database-integration.mjs
```

发布才执行完整验证：

```powershell
pnpm release:check
```

完整顺序为 check → lint → test → build → audit → e2e。普通 CI 运行 check、lint、精简测试；手动勾选 `release` 才运行完整验证。

## 部署与数据库

生产使用 Ubuntu / Nginx / systemd，具体命令见 [部署文档](docs/DEPLOY_UBUNTU_24.md)。迁移只追加，通过 Supabase CLI 按时间戳顺序应用，不改写已登记历史。

本次追加 `202610070001_remove_qq_auth.sql`：

- 删除私有 QQ 绑定表、验证码挑战表及 7 个专属 RPC。
- 删除 `profiles.qq_registration_pending` 与 Auth metadata 中的同名字段。
- 新账号触发器只接受可信后台创建，使用临时密码门禁；数据库角色查询不再读取 QQ 状态。
- 已有账号、密码和角色保留；未完成旧 QQ 注册的账号转入强制改密状态。

**环境状态：2026-10-07 已完成旧库保留数据导入，旧项目未修改。** 新项目已核对 19 个账号、19 个档案、2 张地图、9 条认领、2508 个地图格、6 个标记、15 条历史、135 名成员和 34 张保留图片；Storage 已核对 `site-images` 9 个、`town-maps` 464 个对象，QQ 元数据为 0，认领无孤立 Owner。资源／材料记录和 QQ 绑定数据按退役规则未导入；生产清空迁移 `202610050001` 未执行。详细状态见 [Supabase 文档](supabase/README.md)。

API 构建会清理旧 `dist-server/` 并排除测试，防止退役 QQ 文件残留在产物中。数据库迁移和应用代码须作为同一发布交付。

本轮整理删除了已退役的 QQ 注册、资源、材料和旧服务器控制入口及其前端页面、服务端路由、类型与测试；历史 Supabase 迁移仍完整保留，便于按时间顺序重放和审计。生产数据不进入 Git，`.env`、构建产物、依赖缓存、测试报告和本机备份均由 `.gitignore` 排除。

## 安全边界

- Service Role Key 只在服务器；浏览器角色和可编辑 metadata 不参与授权。
- Fastify 校验 token 与当前 Profile；数据库继续执行 RLS、角色和首次改密门禁。
- 保留请求大小、上传格式／解码大小限制、必要限流和第三方地址白名单。
- 错误统一返回稳定代码，未知错误只记录内部日志；浏览器显示中文或英文产品提示。
- Storage 和 Auth 与数据库不能跨服务原子提交，失败补偿不删除。
- 生产依赖保持锁定；`pnpm audit --prod` 当前无已知漏洞。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [接口与架构](docs/ARCHITECTURE.md) | HTTP / RPC 契约、权限、数据入口和组件职责 |
| [开发](docs/DEVELOPMENT.md) | 本地命令、最小验证、迁移和版本规范 |
| [视觉设计](docs/DESIGN_LANGUAGE.md) | 主题变量、布局、动效和组件样式 |
| [部署](docs/DEPLOY_UBUNTU_24.md) | 生产安装、发布、回滚、备份与旧维护步骤 |
| [交接状态](docs/handoff.md) | 已验证结果、生产差异与独立外部服务 |
| [领域语言](CONTEXT.md) | 地图、Chunk、Claim 与 Marker 定义 |
| [Supabase](supabase/README.md) | 项目初始化、首个 Owner 和类型生成 |
