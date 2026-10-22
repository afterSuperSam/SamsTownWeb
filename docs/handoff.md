# 楹雾镇平台交接与运维手册

> 最后核对：2026-08-12
> 应用版本：v1.9.0
> 生产站点：<https://moesam.com>
> 生产服务器：`64.90.13.129:22`（Ubuntu 24.04）  
> Supabase Project Ref：`hsbshnhtxplqecbhrirt`  
> 私有仓库：`SuperSamWasHere/SamsTownWeb`

本文档是项目的单一交接入口，覆盖架构、功能、权限、源码、数据库、从零部署、版本更新、回滚、机器人联动、端口与常见故障。任何密钥、密码、Access Token 均不得写入本文档或提交到 Git。

---

## 1. 项目定位

楹雾镇网站是面向 Minecraft 玩家社区的在线门户，当前由以下部分组成：

- 公共官网：首页、历史、公告、成员、图集、FAQ 与招新信息。
- 认证系统：Supabase Auth、用户名登录、首次登录强制修改临时密码、QQ 私聊验证码注册与绑定。
- 资源管理：Modrinth、GitHub 和普通 Minecraft 链接导入，项目元数据与更新检查，共享文件上传和下载。
- 小镇地图：上传超大地图、服务端切片、认领 16×16 像素区块、项目合并显示、地图标记和实时刷新。
- 材料互助：导入 Litematica 材料清单、材料元数据解析、全部/部分/快速认领、进度与排行榜。
- 留言论坛：Viewer 查看，Member 及以上创建与管理自己的任务、轶事、活动文本；Owner 后台管理。
- 后台管理：文案、媒体、成员、FAQ、历史、公告、资源、材料、论坛、账号、网页统计和审计日志。
- QQ 机器人通道：NapCat 提供 OneBot 11 HTTP API，AstrBot 通过反向 WebSocket 与 NapCat 联动。

当前网站不是 Docker 应用：React 静态文件和 Fastify 直接部署在 Ubuntu 上；只有 NapCat/AstrBot 使用 Docker Compose。

---

## 2. 总体架构

```text
浏览器
  │ HTTPS 443
  ▼
Nginx（moesam.com）
  ├─ /                     -> /opt/yingwu/current/dist（React）
  ├─ /api/*                -> 127.0.0.1:8787（Fastify）
  └─ /health               -> 127.0.0.1:8787（Fastify）
                                  │
                                  ├─ Supabase Auth
                                  ├─ Supabase PostgreSQL + RLS
                                  ├─ Supabase Storage
                                  ├─ Modrinth/GitHub/Bilibili 等外部 API
                                  └─ 127.0.0.1:3000（NapCat OneBot HTTP）

NapCat 容器 ──反向 WebSocket──> AstrBot 容器
```

### 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 7、React Router 8 |
| UI/动画 | 原生 CSS 设计系统、Motion、Lucide React |
| 地图 | OpenSeadragon |
| API | Fastify 5、Zod、Sharp、Multipart、Rate Limit |
| 数据 | Supabase Auth、PostgreSQL、RLS、RPC、Storage、Realtime |
| 测试 | Vitest、Testing Library、Playwright |
| 生产入口 | Nginx、systemd、Certbot |
| QQ | NapCat OneBot 11 HTTP、AstrBot 反向 WebSocket、Docker Compose |

### 生产路径速查

| 内容 | 路径/名称 |
| --- | --- |
| Git 工作源 | `/opt/yingwu/source` |
| 不可变版本目录 | `/opt/yingwu/releases/<commit>-<timestamp>` |
| 当前线上软链接 | `/opt/yingwu/current` |
| React 构建产物 | `/opt/yingwu/current/dist` |
| Fastify 构建产物 | `/opt/yingwu/current/dist-server` |
| 生产环境变量 | `/etc/yingwu/yingwu.env` |
| Fastify systemd | `/etc/systemd/system/yingwu-api.service` |
| Nginx 站点 | `/etc/nginx/sites-available/yingwu` |
| NapCat/AstrBot Compose | `/opt/yingwu-bot/docker-compose.yml` |
| Fastify 日志 | `journalctl -u yingwu-api` |
| Nginx 错误日志 | `/var/log/nginx/error.log` |

### 信任边界

- 浏览器中的 `VITE_*` 变量可见，不能存放任何秘密。
- 数据库普通访问由 Supabase RLS 约束，不能只依赖前端按钮隐藏。
- Service Role Key 只允许 Fastify 使用，绝不能进入浏览器包或 Git。
- 账号管理、QQ 验证、地图切片和部分可信写入必须经过 Fastify。
- NapCat HTTP 端口只能绑定宿主机回环地址 `127.0.0.1`。

---

## 3. 页面、功能与路由

| 路由 | 页面 | 访问条件 | 主要功能 |
| --- | --- | --- | --- |
| `/` | HomePage | 公开 | Hero、简介、选择理由、图集、成员、历史预览、FAQ、公告与加入方式 |
| `/history` | HistoryPage | 公开 | 小镇档案、完整成员名录、历史时间线、滚动曲线和关联媒体 |
| `/login` | Redirect | 公开 | 兼容入口，立即跳转 `/account` |
| `/resources` | ResourcesPage | Member+ | 项目资源、筛选、统计、更新检查、共享文件 |
| `/map` | AtlasPage | 公开 | 查看可见地图、认领和标记；Member 可认领，Admin/Owner 可管理 |
| `/materials` | MaterialPage | Viewer+ | 查看项目；Member+ 可导入、认领和维护自己的互助记录 |
| `/forum` | ForumPage | Viewer+ | 最新内容与公告筛选；Member+ 可发布和编辑自己的内容 |
| `/account` | AccountPage | 公开 / Viewer+ | 未登录时登录或 QQ 注册；登录后管理账号与 QQ 绑定 |
| `/admin` | AdminPage | Owner | 全站内容、资源、账号、统计和系统管理 |

所有非首页路由采用懒加载。根级 Error Boundary 负责避免未捕获错误导致永久白屏。

---

## 4. 权限模型

权限定义的代码事实来源是 `src/domain/permissions.ts`，数据库事实来源是各迁移中的 RLS/RPC，Fastify 事实来源是 `server/auth.ts`。三处变更必须同步检查。

| 能力 | Viewer | Member | Admin | Owner |
| --- | :---: | :---: | :---: | :---: |
| 登录与个人资料 | ✓ | ✓ | ✓ | ✓ |
| 查看地图（未登录也可） | ✓ | ✓ | ✓ | ✓ |
| 创建/管理自己的地图认领 |  | ✓ | ✓ | ✓ |
| 管理地图、全部认领和标记 |  |  | ✓ | ✓ |
| 查看材料互助 | ✓ | ✓ | ✓ | ✓ |
| 编辑/认领材料项目 |  | ✓ | ✓ | ✓ |
| 查看论坛 | ✓ | ✓ | ✓ | ✓ |
| 创建/编辑自己的论坛文本 |  | ✓ | ✓ | ✓ |
| 使用资源中心 |  | ✓ | ✓ | ✓ |
| 进入后台 |  |  |  | ✓ |
| 管理账号和全站内容 |  |  |  | ✓ |

补充规则：

- 新账号使用临时密码时，`must_change_password=true`；首次登录必须二次确认新密码后才能进入其他受保护页面。
- QQ 自助注册尚未完成时，`qq_registration_pending=true`，后端拒绝该账号访问业务 API。
- Owner 可创建、修改和删除账号；删除最后一个 Owner 受数据库事务与锁保护。
- Admin 与 Member 的通用内容权限目前接近，但 Admin 额外拥有地图管理能力；不要以字符串大小或数组顺序推断权限，应始终调用 `can()`。

---

## 5. 主要源码结构

```text
SamsTownWeb/
├─ src/                         React 前端
│  ├─ App.tsx                  路由、懒加载与权限入口
│  ├─ pages/                   页面级组件
│  ├─ components/              全局可复用 UI、Hero、媒体、对话框、错误边界
│  ├─ features/
│  │  ├─ admin/                后台各面板
│  │  ├─ auth/                 QQ 注册/绑定前端流程
│  │  ├─ forum/                论坛卡片、编辑器、仓储层
│  │  ├─ map/                  地图领域、数据、Hook 和视图组件
│  │  ├─ material/             材料解析、认领、项目卡片与对话框
│  │  └─ resources/            资源导入对话框
│  ├─ services/                Supabase/API 数据访问层
│  ├─ state/AuthContext.tsx    会话与 Profile 状态
│  ├─ domain/                  领域类型、默认数据、权限模型
│  ├─ lib/                     Supabase 客户端、环境、JSON、URL 和 Motion 工具
│  ├─ i18n/                    中英文词条和错误映射
│  ├─ styles/                  全局设计变量和页面样式
│  └─ theme/                   深色/浅色主题
├─ server/                      Fastify API
│  ├─ app.ts                   插件、错误处理、限流和路由注册
│  ├─ index.ts                 监听入口
│  ├─ config.ts                服务端环境变量校验
│  ├─ auth.ts                  Bearer Token 与角色守卫
│  ├─ routes/                  Auth、账号、统计、Bilibili、地图、材料、QQ
│  ├─ maps/                    图片校验、Sharp 切片、Storage 和地图服务
│  ├─ qqVerification.ts        验证码生成、哈希和 OneBot 私聊发送
│  ├─ storageCleanup.ts        Storage 删除补偿队列 Worker
│  ├─ accountCleanup.ts        Auth 半删除账号补偿队列 Worker
│  └─ supabaseAdmin.ts         Service Role 客户端
├─ supabase/
│  ├─ migrations/              按文件名顺序执行的数据库迁移
│  └─ config.toml              Supabase CLI 配置
├─ images/                      生产所需的优化图片与当前本地媒体
├─ public/                      Favicon 与首屏主题初始化脚本
├─ tests/                       跨模块回归契约测试
├─ e2e/                         Playwright 烟雾与视觉契约测试
├─ docs/DEPLOY_UBUNTU_24.md     简版 Ubuntu 部署说明
├─ docs/handoff.md              本交接手册
├─ vite.config.ts               构建、版本注入和图片复制逻辑
├─ package.json                 版本、依赖与脚本
└─ .env.example                 无秘密的环境变量模板
```

### 重要前端模块

- `siteRepository.ts`：首页、历史、成员、媒体、FAQ、公告等公共内容。
- `resourceRepository.ts`：Modrinth/GitHub 链接解析、分页、更新检查和共享文件。
- `mapRepository.ts`/`mapApi.ts`：地图读写、Fastify 地图 API 与 Realtime。
- `materialRepository.ts`：材料项目、认领、排行榜和管理操作。
- `forumRepository.ts`：论坛列表、创建、编辑与删除。
- `apiClient.ts`：携带 Supabase Access Token 调用 Fastify。
- `useTownHero.ts`：非首页页面统一的 Hero 媒体读取、取消与失败回退。

### Fastify API

- `/health`：健康检查。
- `/api/auth/sign-in`、`/api/auth/change-password`：用户名登录和强制改密。
- `/api/auth/qq/*`、`/api/profile/qq/*`：QQ 验证注册与绑定。
- `/api/accounts*`：Owner 账号管理。
- `/api/maps*`：地图创建、更新、图片上传、删除和切片访问。
- `/api/materials/projects`：可信材料元数据解析和项目创建。
- `/api/bilibili/resolve`：Owner 导入 Bilibili 视频元数据。
- `/api/analytics/view`：限流后的页面浏览计数。

---

## 6. Supabase 数据层

### 主要业务表

| 分类 | 表 |
| --- | --- |
| 账号 | `profiles`、私有 schema 下的 QQ 身份与验证码挑战 |
| 内容 | `site_content`、`town_members`、`town_history`、`faq_items`、`town_announcements`、`town_images` |
| 资源 | `resources`、`schematics` |
| 地图 | `town_maps`、`map_claims`、`map_claim_cells`、`map_markers` |
| 材料 | `material_projects`、`material_items`、`material_assignments` |
| 论坛 | `forum_posts` |
| 运维 | `daily_page_views`、`audit_logs`、`storage_cleanup_queue`、`account_deletion_queue` |

### 预留但当前未接入页面的 Folia 表

`game_servers`、`player_profiles`、`server_metrics`、`server_commands` 已存在于早期基线迁移和生成类型中，但当前 `src/` 与 `server/` 没有业务调用。`20260820144733_retire_unused_server_data_api.sql` 已撤销匿名和普通认证角色的表权限；未来接入 Folia 时必须通过新的可信服务端迁移重新开放所需的最小权限。

### Storage bucket

| Bucket | 用途 | 访问原则 |
| --- | --- | --- |
| `site-images` | 网站媒体图片 | 已知公开 URL 可展示；对象列表和归档元数据仅 Owner 可读写 |
| `schematics` | `.litematic`、`.jar`、图片、文本及其他共享文件 | Member+ 通过策略访问，25 MiB 上限 |
| `town-maps` | 地图原图与生成的 WebP 瓦片 | 私有，只允许符合地图权限的认证用户读取；写入经 Fastify |

删除 Storage 对象和 Supabase Auth 半删除账号均使用补偿队列。Fastify Worker 会按退避策略重试，连续失败 8 次进入 dead-letter 状态，不能绕过队列手工破坏一致性。

### 地图约束

- 上传文件最大 50 MiB，支持 PNG/JPEG/WebP/TIFF。
- 解码后最大 6400 万像素、单边最大 16384 像素、约 2500 个瓦片。
- 一个地图像素代表一个 Minecraft 方块；16×16 像素为一个可认领区块。
- 相邻认领按上下左右连接合并显示；不同项目不允许重叠认领。
- 地图图片由 Sharp 在 Fastify 中切片，前端使用 OpenSeadragon 浏览。

### 迁移规则

- 部署时必须按文件名顺序应用 `supabase/migrations/` 中的全部迁移，并以 linked migration list 与 dry-run 结果确认边界。
- 永远按文件名顺序执行全部待应用迁移，不要从中间复制 SQL 到生产库。
- 已在远端登记的历史迁移文件不能改名、删除或改写。
- `src/lib/database.types.ts` 应在 schema 变化后重新生成并提交。

### v1.6.0 关键变化

- 关闭 Supabase 公开注册并让 QQ 注册状态由可信服务端元数据决定。
- 媒体归档、资源字段、论坛深分页和地图替换增加数据库侧约束。
- 地图与 Auth 清理改为可租约、可退避、可 dead-letter 的补偿 Worker。
- 资源更新检查覆盖全部 Modrinth/GitHub 项目，不再只检查当前分页。
- 页面异步请求增加竞态/超时保护，后台草稿、论坛错误和地图键盘操作保持一致。

---

## 7. 环境变量

本地复制 `.env.example` 为 `.env`。生产使用 `/etc/yingwu/yingwu.env`，不要把生产环境文件放入 release 或 Git。

```dotenv
# 浏览器可见
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
VITE_API_URL=https://moesam.com

# 仅 Fastify
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
API_HOST=127.0.0.1
API_PORT=8787
API_TRUST_PROXY=loopback
WEB_ORIGIN=https://moesam.com
STORAGE_CLEANUP_INTERVAL_MS=300000
ACCOUNT_CLEANUP_INTERVAL_MS=300000

# 可选但生产已启用的 QQ 验证
BOT_API_URL=http://127.0.0.1:3000
BOT_API_KEY=ONEBOT_HTTP_ACCESS_TOKEN
QQ_CODE_PEPPER=INDEPENDENT_RANDOM_32_PLUS_CHARACTER_SECRET
ANALYTICS_IP_PEPPER=ANOTHER_INDEPENDENT_RANDOM_32_PLUS_CHARACTER_SECRET

```

约束：

- `SUPABASE_SERVICE_ROLE_KEY`、`BOT_API_KEY`、`QQ_CODE_PEPPER`、`ANALYTICS_IP_PEPPER` 是秘密。
- `BOT_API_KEY` 与 NapCat HTTP 服务的 Token 必须完全一致。
- `BOT_API_URL` 在代码中被强制限制为 loopback 主机。
- `BOT_API_KEY` 至少 20 字符；`QQ_CODE_PEPPER` 与 `ANALYTICS_IP_PEPPER` 至少 32 字符，且三个秘密不能复用。
- 可分别运行两次 `openssl rand -hex 32` 生成。
- 修改生产变量后必须 `systemctl restart yingwu-api`；修改 `VITE_*` 后还必须重新构建前端。

如任何真实 Service Role Key 曾进入 Git、聊天记录或公开日志，应立即在 Supabase 控制台轮换，并同步 `/etc/yingwu/yingwu.env`。

---

## 8. 本地开发

### 前置工具

- Git
- Node.js `>=22.22.0`
- Corepack 与 pnpm `11.9.0`
- Supabase 项目；需要本地数据库时还需 Docker Desktop 与 Supabase CLI
- 可选：Playwright Chromium

### 初始化

```powershell
git clone git@github.com:SuperSamWasHere/SamsTownWeb.git
Set-Location SamsTownWeb
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

填写 `.env` 后启动统一开发进程：

```powershell
pnpm dev
```

如需分别调试，可使用 `pnpm dev:web` 和 `pnpm api:dev`。

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`
- 健康检查：`http://127.0.0.1:8787/health`

### 提交前检查

```powershell
pnpm check
pnpm test
pnpm build
pnpm api:build
pnpm audit --prod
pnpm test:e2e
git diff --check
```

Playwright 首次运行前：

```powershell
pnpm exec playwright install chromium
```

站点公开内容只以 Supabase 为来源；仓库不再同步或打包生产内容快照。

---

## 9. 从零部署 Ubuntu 24

以下流程使用当前生产域名和目录。SSH 部署账号负责拉取与构建，Fastify 必须使用不可登录的 `yingwu` 系统账号运行，不能继续以 root 运行公网服务。

### 9.1 DNS 与防火墙

将 `moesam.com` 的 A 记录指向 `64.90.13.129`。服务器只需公开：

```bash
apt update
apt install -y git nginx certbot python3-certbot-nginx rsync curl ca-certificates
id -u yingwu >/dev/null 2>&1 || useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin yingwu
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

### 9.2 安装 Node 22 与 pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version
npm install -g corepack@latest
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm --version
```

确认 Node 满足 `>=22.22.0`，否则升级后再继续。

### 9.3 克隆私有 GitHub 仓库

推荐使用只读 Deploy Key：

```bash
ssh-keygen -t ed25519 -C 'yingwu-production' -f ~/.ssh/yingwu_github -N ''
cat ~/.ssh/yingwu_github.pub
```

把公钥添加到 GitHub 仓库：**Settings → Deploy keys → Add deploy key**，只读即可。配置 SSH：

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-yingwu
  HostName github.com
  User git
  IdentityFile ~/.ssh/yingwu_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh-keyscan -H github.com >> ~/.ssh/known_hosts
ssh -T git@github-yingwu
```

首次写入 `known_hosts` 前，应把扫描到的主机密钥指纹与 GitHub 官方文档公布的指纹核对，避免在不可信网络上直接接受未知主机密钥。

创建部署目录并克隆：

```bash
mkdir -p /opt/yingwu/source /opt/yingwu/releases /etc/yingwu
git clone git@github-yingwu:SuperSamWasHere/SamsTownWeb.git /opt/yingwu/source
```

也可以使用具有限定仓库权限的 GitHub fine-grained PAT，但不要把 Token 写进 remote URL、脚本或 Shell history。

### 9.4 创建生产环境变量

```bash
nano /etc/yingwu/yingwu.env
chown root:yingwu /etc/yingwu/yingwu.env
chmod 640 /etc/yingwu/yingwu.env
```

内容使用第 7 节模板。不要在命令行回显秘密。

### 9.5 初始化/升级 Supabase

在 Supabase Dashboard 创建项目并取得 Project Ref、URL、Publishable/Anon Key 和 Service Role Key。个人 Access Token 从 Supabase Account Tokens 页面创建，格式通常为 `sbp_...`，它不是 Anon Key。

```bash
cd /opt/yingwu/source
read -rsp 'Supabase Access Token: ' SUPABASE_ACCESS_TOKEN
export SUPABASE_ACCESS_TOKEN
echo
pnpm dlx supabase@2.109.1 link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
unset SUPABASE_ACCESS_TOKEN
```

新项目首次建立 Owner：

1. 在 Supabase Authentication 创建一个 Email/Password 用户，metadata 设置 `{"username":"DogSam"}`。
2. 复制该 Auth 用户 UUID。
3. 在 SQL Editor 仅执行一次：

```sql
update public.profiles
set username = 'DogSam', role = 'owner', must_change_password = false
where id = 'AUTH_USER_UUID';
```

4. 在 Authentication → Providers → Email 关闭公开注册，但保留 Email/Password 登录。后续 Owner 后台创建账号或 QQ 验证注册通过 Fastify Service Role 完成。

### 9.6 构建第一个 release

```bash
cd /opt/yingwu/source
git fetch --prune origin
REV="$(git rev-parse origin/main)"
RELEASE="/opt/yingwu/releases/${REV}-$(date +%Y%m%d%H%M%S)"
git worktree add --detach "$RELEASE" "$REV"
ln -s /etc/yingwu/yingwu.env "$RELEASE/.env"
cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm audit --prod
pnpm build
pnpm api:build
ln -sfn "$RELEASE" /opt/yingwu/current
```

### 9.7 systemd

创建 `/etc/systemd/system/yingwu-api.service`：

```ini
[Unit]
Description=Yingwu Town Fastify API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=yingwu
Group=yingwu
WorkingDirectory=/opt/yingwu/current
Environment=NODE_ENV=production
EnvironmentFile=/etc/yingwu/yingwu.env
ExecStart=/usr/bin/node dist-server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

确保 release 对服务账号可读，然后核对真实配置：

```bash
chmod -R a+rX /opt/yingwu/releases /opt/yingwu/current
```

当前环境的真实配置始终以以下命令为准：

```bash
systemctl cat yingwu-api
```

启动：

```bash
systemctl daemon-reload
systemctl enable --now yingwu-api
systemctl status yingwu-api --no-pager -l
curl --fail http://127.0.0.1:8787/health
```

### 9.8 Nginx

创建 `/etc/nginx/sites-available/yingwu`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name moesam.com;

    root /opt/yingwu/current/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8787/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        client_max_body_size 52m;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(?:css|js|svg|png|jpg|jpeg|webp|gif|woff2)$ {
        expires 7d;
        try_files $uri =404;
    }
}
```

生产站点还应保留 `docs/DEPLOY_UBUNTU_24.md` 中列出的 CSP、HSTS、X-Content-Type-Options、Referrer-Policy 和 Permissions-Policy 响应头。启用：

```bash
ln -s /etc/nginx/sites-available/yingwu /etc/nginx/sites-enabled/yingwu
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### 9.9 HTTPS

```bash
certbot --nginx -d moesam.com
certbot renew --dry-run
curl --fail https://moesam.com/health
```

Supabase Authentication URL Configuration 中同步设置：

- Site URL：`https://moesam.com`
- Redirect URL：`https://moesam.com/**`

---

## 10. NapCat 与 AstrBot 部署

### 当前生产目录

```text
/opt/yingwu-bot/
├─ docker-compose.yml
├─ data/
├─ napcat/config/
└─ ntqq/
```

Compose 的核心配置：

```yaml
services:
  napcat:
    image: mlikiowa/napcat-docker:latest
    container_name: napcat
    restart: always
    environment:
      - NAPCAT_UID=0
      - NAPCAT_GID=0
      - MODE=astrbot
    ports:
      - "127.0.0.1:6099:6099"
      - "127.0.0.1:3000:3000"
    volumes:
      - ./data:/AstrBot/data
      - ./napcat/config:/app/napcat/config
      - ./ntqq:/app/.config/QQ
    networks: [bot_network]

  astrbot:
    image: soulter/astrbot:latest
    container_name: astrbot
    restart: always
    ports:
      - "127.0.0.1:6185:6185"
    volumes:
      - ./data:/AstrBot/data
    networks: [bot_network]

networks:
  bot_network:
    driver: bridge
```

NapCat WebUI 网络配置：

- **HTTP 服务**：`0.0.0.0:3000`，启用，Token 与 `BOT_API_KEY` 相同。
- **HTTP 上报服务**：禁用；它不是网站调用接口，误填 `0.0.0.0:3000` 会产生 `Invalid URL`。
- **反向 WebSocket**：`ws://astrbot:6199/ws`，用于 AstrBot。

启动与验证：

```bash
cd /opt/yingwu-bot
docker compose config --quiet
docker compose up -d
docker compose ps
docker logs --tail 100 napcat
docker port napcat
ss -lntp | grep ':3000'
```

宿主机必须出现：

```text
127.0.0.1:3000 -> napcat:3000
```

OneBot 验证：

```bash
set -a
source /etc/yingwu/yingwu.env
set +a

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${BOT_API_KEY}" \
  "${BOT_API_URL%/}/get_login_info"
```

发送私聊测试：

```bash
read -rp '测试QQ号: ' TEST_QQ
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer ${BOT_API_KEY}" \
  -H 'Content-Type: application/json' \
  --data "{\"user_id\":${TEST_QQ},\"message\":\"楹雾镇验证码通道测试\"}" \
  "${BOT_API_URL%/}/send_private_msg"
```

必须返回 `status=ok`、`retcode=0`。若 `127.0.0.1:3000` 拒绝连接，先检查 `docker port napcat` 是否缺少 `127.0.0.1:3000:3000`，不要修改网站代码。

安全建议：`6099` 和 `6185` 当前可能映射到 `0.0.0.0`。如果不需要公网直接访问，应改为 `127.0.0.1:6099:6099` 和 `127.0.0.1:6185:6185`，再通过 SSH 隧道访问管理界面：

```powershell
ssh -L 6099:127.0.0.1:6099 -L 6185:127.0.0.1:6185 root@64.90.13.129
```

## 11. 端口清单

| 端口 | 绑定 | 服务 | 是否应公网开放 |
| --- | --- | --- | --- |
| 22/TCP | `0.0.0.0` | SSH | 是，建议仅密钥登录并限制来源 |
| 80/TCP | `0.0.0.0` | Nginx HTTP/证书跳转 | 是 |
| 443/TCP | `0.0.0.0` | Nginx HTTPS | 是 |
| 5173/TCP | `127.0.0.1` | Vite 本地开发/预览 | 否，生产不需要 |
| 8787/TCP | `127.0.0.1` | Fastify | 否，只由 Nginx 访问 |
| 3000/TCP | `127.0.0.1` | NapCat OneBot HTTP | 否，只由 Fastify 访问 |
| 6099/TCP | 建议 `127.0.0.1` | NapCat WebUI | 否，使用 SSH 隧道 |
| 6185/TCP | 建议 `127.0.0.1` | AstrBot WebUI | 否，使用 SSH 隧道 |
| 6199/TCP | Docker 内网 | AstrBot WebSocket | 否，不映射宿主机 |
| 5432 等 | Supabase 托管 | PostgreSQL/API | 不在本机开放 |

---

## 12. 发布新版本

### 12.1 代码与数据库版本同步

发布 `vX.Y.Z` 时至少同步：

1. `package.json` 的 `version`。
2. Footer 会通过 Vite 的 `__APP_VERSION__` 自动读取，不应再硬编码。
3. 新建一条 release 迁移，例如 `YYYYMMDDNNNN_release_vX_Y_Z.sql`，更新数据库版本标记。
4. 更新涉及版本的测试和文档。
5. 运行完整检查后提交并推送 `main`。

### 12.2 服务器原子更新

```bash
cd /opt/yingwu/source
git fetch --prune origin
REV="$(git rev-parse origin/main)"
RELEASE="/opt/yingwu/releases/${REV}-$(date +%Y%m%d%H%M%S)"
git worktree add --detach "$RELEASE" "$REV"
ln -s /etc/yingwu/yingwu.env "$RELEASE/.env"

cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm audit --prod
pnpm build
pnpm api:build
chmod -R a+rX "$RELEASE"
```

如包含新迁移，在切换应用前执行：

```bash
cd /opt/yingwu/source
read -rsp 'Supabase Access Token: ' SUPABASE_ACCESS_TOKEN
export SUPABASE_ACCESS_TOKEN
echo
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
unset SUPABASE_ACCESS_TOKEN
```

切换并验收：

```bash
ln -sfn "$RELEASE" /opt/yingwu/current
systemctl restart yingwu-api
nginx -t && systemctl reload nginx
curl --fail http://127.0.0.1:8787/health
curl --fail https://moesam.com/health
curl -I https://moesam.com/
```

数据库迁移一般是向前兼容且不可自动回滚，因此新代码必须在迁移成功后切换；破坏性 schema 修改需要单独设计双阶段发布。

### 12.3 GitHub Actions

仓库使用 `.github/workflows/ci.yml` 验证类型、测试、生产依赖和构建，不再发布 GitHub Pages。React 与 Fastify 统一由 Ubuntu/Nginx 同域部署，确保前后端始终使用同一版本。

---

## 13. 回滚

查看 release：

```bash
readlink -f /opt/yingwu/current
ls -1dt /opt/yingwu/releases/* | head -n 10
```

切回上一个已验证目录：

```bash
ln -sfn /opt/yingwu/releases/PREVIOUS_RELEASE /opt/yingwu/current
systemctl restart yingwu-api
nginx -t && systemctl reload nginx
curl --fail https://moesam.com/health
```

注意：代码回滚不会回滚 Supabase 数据库。若新迁移不兼容旧代码，应使用向前修复迁移，不能擅自删除远端迁移记录或恢复旧 SQL 文件。

清理旧 release 前必须确认目标不是 `current`：

```bash
readlink -f /opt/yingwu/current
```

建议至少保留最近 3 个已验证 release。

---

## 14. 日志、监控与备份

```bash
systemctl is-active nginx yingwu-api
journalctl -u yingwu-api -n 200 --no-pager
journalctl -u yingwu-api -f
tail -n 200 /var/log/nginx/error.log
docker compose -f /opt/yingwu-bot/docker-compose.yml ps
docker logs --tail 200 napcat
docker logs --tail 200 astrbot
curl --fail https://moesam.com/health
```

备份要求：

- Supabase 开启数据库备份/PITR（按套餐能力）。
- 定期导出或验证 `site-images`、`schematics`、`town-maps` 的恢复能力。
- 备份 `/etc/yingwu/yingwu.env` 到加密密码库，不要放进普通网盘或 Git。
- 备份 `/opt/yingwu-bot/data`、`napcat/config`、`ntqq`，其中可能包含登录态和敏感信息。
- 定期测试一次代码 release 回滚、数据库恢复和机器人重新登录。

审计说明：网页统计只保存按天聚合的总浏览和登录用户浏览次数，不保存 IP/设备指纹。业务审计日志默认保留 7 天；当前清理由业务变更触发或 Owner 主动清理，不是严格定时任务。如需严格保留期，应后续配置 Supabase `pg_cron` 或 Ubuntu 定时任务。

---

## 15. 常见故障

### 网站显示“后台服务尚未连接”

```bash
systemctl status yingwu-api --no-pager -l
journalctl -u yingwu-api -n 100 --no-pager
curl -i http://127.0.0.1:8787/health
curl -i https://moesam.com/health
systemctl cat yingwu-api
readlink -f /opt/yingwu/current
```

重点检查 systemd 的 `WorkingDirectory` 是否为 `/opt/yingwu/current`，以及 `dist-server/index.js` 是否来自当前 release。

### QQ 验证码发送失败

按顺序检查：

```bash
docker port napcat
ss -lntp | grep ':3000'
curl -H "Authorization: Bearer ${BOT_API_KEY}" http://127.0.0.1:3000/get_login_info
docker logs --tail 100 napcat
journalctl -u yingwu-api -n 100 --no-pager
```

- NapCat 应启用“HTTP 服务”，不是“HTTP 上报服务”。
- Compose 必须包含 `127.0.0.1:3000:3000`。
- 容器刚重建时应等待 QQ 与 HTTP Adapter 完成启动后再测试。
- `BOT_API_KEY` 必须与 OneBot Token 一致。

### 数据库提示尚未升级

```bash
cd /opt/yingwu/source
export SUPABASE_ACCESS_TOKEN='临时输入，不要写入文件'
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
unset SUPABASE_ACCESS_TOKEN
```

确认最新 migration 本地与远端均存在。不要只修改网页版本号来绕过提示。

### 构建出现 Merge conflict marker

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)' . \
  -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**'
```

不要把带冲突标记的 release 切换为 `current`。仓库回归测试也会检测常见源码和配置文件中的冲突标记。

### 上传地图失败

- 检查 Nginx `client_max_body_size 52m`。
- 检查 Fastify 日志与 Supabase Storage 配额。
- 确认图片小于 50 MiB、6400 万像素、16384 单边和瓦片上限。
- 检查 `town-maps` RLS 与 Storage 清理队列，不要直接改成 public bucket。

---

## 16. 安全基线

- SSH 优先使用密钥，关闭 root 密码登录前先验证专用管理账号可用。
- UFW 只开放 22/80/443；3000/8787/6099/6185 不应直接公网开放。
- 所有服务端输入通过 Zod、数据库约束或文件解码限制验证。
- Fastify 设置登录、QQ、Bilibili、材料导入和统计接口限流。
- 外部 URL 只允许 HTTP/HTTPS，并对 Modrinth/GitHub 请求设置超时。
- Supabase RLS、RPC 权限和 Storage policy 是最终授权边界。
- Service Role Key、OneBot Token、QQ Pepper、Supabase PAT 不进 Git、不进前端、不进截图。
- 删除账号和 Storage 文件使用事务/补偿队列，禁止用无 WHERE 的手工 DELETE。
- 每次依赖升级运行 `pnpm audit --prod`，但不要在未验证时自动执行破坏性修复。
- 定期检查 Nginx CSP 是否仍覆盖 Supabase、Modrinth、GitHub、Bilibili 和问卷来源。

---

## 17. 未来计划与扩展边界

以下为已有方向或数据层预留，不代表当前已上线：

1. **Folia 服务端插件联动**：可信插件通过独立服务凭据向 Fastify 上报玩家、服务器指标和命令结果；不能让插件持有 Supabase Service Role Key。
2. **Squaremap 集成**：优先嵌入/代理 Squaremap 的只读地图能力，与现有“规划认领地图”保持领域隔离；二者用途不同，不应复用同一表。
3. **玩家资料**：使用 Minecraft UUID 作为稳定标识，用户名仅作为可变展示字段；在线状态和统计需定义缓存与隐私策略。
4. **服务器后台控制**：任何命令必须经过 Owner/Admin 授权、白名单、幂等键、审计和服务端回执，禁止提供任意控制台字符串执行接口。
5. **严格日志保留期**：用 `pg_cron` 或受监控的 systemd timer 每日清理超过 7 天的业务审计日志。
6. **CI/CD 完整化**：让 GitHub Actions 构建可部署 artifact，由服务器拉取并原子切换；生产迁移仍需人工审批。
7. **机器人业务查询**：若未来恢复 QQ Bot 查询成员/历史/材料功能，应调用只读、限流、字段白名单的 Fastify 内部 API，而不是让 Bot 直接访问数据库。

扩展原则：先定义领域、权限和数据所有权，再增加页面或表；不在多个页面重复实现同一控件，不把预留接口当作已完成能力。

---

## 18. 交接验收清单

### 当前工作树本地验证记录（2026-08-20）

- `pnpm check`：通过（前端 TypeScript 与 Fastify 编译均成功）。
- `pnpm lint`：通过（TypeScript 与 React Hooks）。
- `pnpm test`：通过（45 个测试文件，共 162 项测试）。
- `pnpm build`：通过；生产包未包含已删除的 `images/map.png`、cloud 兼容图与原始 PNG。
- `pnpm test:e2e`：通过（9 项 Playwright 浏览器测试）。
- `pnpm audit --prod`：未发现已知生产依赖漏洞。
- `git diff --check` 与冲突标记扫描：通过。
- 本机没有可用的 Docker/Supabase 本地运行时，因此迁移尚未通过本地 `supabase db reset` 实跑；部署前必须在已链接项目执行 `db push`、`migration list` 与 `db lint`。

- [ ] GitHub 私有仓库 SSH/Deploy Key 可用。
- [ ] `/opt/yingwu/source`、`releases`、`current` 结构正常。
- [ ] `/etc/yingwu/yingwu.env` 存在且权限正确。
- [ ] Supabase migration list 本地与远端一致，且 dry-run 不遗漏仓库中的任何迁移。
- [ ] `pnpm check`、`pnpm test`、`pnpm build`、`pnpm api:build` 通过。
- [ ] `yingwu-api` 开机自启，`/health` 返回成功。
- [ ] Nginx 配置通过且 HTTPS 自动续期正常。
- [ ] NapCat 3000 仅绑定 `127.0.0.1`，OneBot 私聊测试成功。
- [ ] Viewer、Member、Admin、Owner 四类账号权限按表验证。
- [ ] 首页、历史、资源、地图、材料、论坛、账号、后台均完成桌面和移动端烟雾测试。
- [ ] Supabase 数据库/Storage 与机器人配置具备可恢复备份。
- [ ] 已记录当前 release 路径与可回滚的上一版本。
