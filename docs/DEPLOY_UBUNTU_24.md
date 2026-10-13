# Ubuntu 24 生产部署

本文档只负责 Ubuntu 24.04 的首次部署、发布、回滚和故障处理。项目结构见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，本地开发见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。当前站点和 Supabase 项目已写入示例；SSH 用户、密钥和所有秘密仍必须在可信终端核对。

推荐拓扑是同一域名下由 Nginx 提供 React 静态文件，并把 `/api` 与 `/health`
反向代理到仅监听 `127.0.0.1:8787` 的 Fastify。这样登录、50 MB 地图上传和
限流都不需要额外的跨域配置。

```text
Browser -> HTTPS/Nginx -> /                 React dist/
                       -> /api, /health     Fastify/systemd -> Supabase
```

以下示例使用：

- 域名：`yingwutown.top`
- Linux 部署用户：`ubuntu`（请替换为实际 SSH 用户）
- 项目：`git@github.com:afterSuperSam/SamsTownWeb.git`
- 安装目录：`/opt/yingwu`

## 1. 前置工具与下载

只使用官方来源：

| 工具 | 要求 | 官方入口 |
| --- | --- | --- |
| Ubuntu Server | 24.04 LTS | [ubuntu.com/download/server](https://ubuntu.com/download/server) |
| Git | Ubuntu 仓库版本 | [git-scm.com/download/linux](https://git-scm.com/download/linux) |
| Node.js | `>=22.22.0`，推荐 24 LTS | [Node.js 下载](https://nodejs.org/en/download) / [最新 24.x 官方目录](https://nodejs.org/download/release/latest-v24.x/) |
| pnpm | `11.9.0` | [pnpm.io/installation](https://pnpm.io/installation) |
| Supabase CLI | 项目固定 `2.109.1`，通过 `pnpm dlx` 运行 | [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| Nginx/Certbot | Ubuntu 24.04 仓库版本 | [Ubuntu certbot 软件包](https://packages.ubuntu.com/noble/certbot) |
| PostgreSQL 客户端 | 备份需 `pg_dump`、`pg_restore` 均为 17+，restore 不低于 dump | [PostgreSQL Ubuntu/PGDG 官方安装入口](https://www.postgresql.org/download/linux/ubuntu/) |

先把域名 A/AAAA 记录指向服务器，再安装系统工具：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nginx certbot python3-certbot-nginx rsync tar unzip jq sqlite3 build-essential python3 pkg-config
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

安装 Node.js 时优先按 Node.js 官方下载页选择适合 Ubuntu 的安装方式。安装完成后启用项目固定 pnpm：

```bash
node --version
npm --version
sudo npm install -g corepack@latest
sudo corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm --version
```

必须确认 Node 满足 `>=22.22.0`、pnpm 为 `11.9.0`。随后创建服务账号和共享秘密组：

```bash
getent group yingwu-secrets >/dev/null || sudo groupadd --system yingwu-secrets
id -u yingwu >/dev/null 2>&1 || sudo useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin yingwu
sudo usermod -aG yingwu-secrets yingwu
sudo usermod -aG yingwu-secrets ubuntu
```

`ubuntu` 是示例部署用户，必须替换为实际账号。重新登录 SSH 让组成员关系生效，然后验证：

```bash
id
node --version
pnpm --version
git --version
ssh -T git@github.com
```

Fastify 使用不可登录的 `yingwu` 账号；只有受信任的部署用户与 Fastify 可以读取生产环境文件。

## 2. 克隆源码

```bash
sudo mkdir -p /opt/yingwu/source /opt/yingwu/releases /etc/yingwu
sudo chown -R ubuntu:ubuntu /opt/yingwu
git clone git@github.com:afterSuperSam/SamsTownWeb.git /opt/yingwu/source
cd /opt/yingwu/source
git fetch --prune origin
```

使用独立 release 目录可以在新版本失败时保留当前运行版本。首次创建 release：

```bash
REV="$(git rev-parse origin/main)"
RELEASE="/opt/yingwu/releases/${REV}-$(date +%Y%m%d%H%M%S)"
git worktree add --detach "$RELEASE" "$REV"
sudo chmod -R a+rX "$RELEASE"
```

## 3. 配置生产环境变量

创建只允许 root、Fastify 与受信任部署用户读取的配置：

```bash
sudo nano /etc/yingwu/yingwu.env
sudo chown root:yingwu-secrets /etc/yingwu/yingwu.env
sudo chmod 640 /etc/yingwu/yingwu.env
```

用 `test -r /etc/yingwu/yingwu.env` 分别确认部署用户和 `yingwu` 服务账号可读。否则 Vite 无法从 release 中的 `.env` 软链接读取生产变量，或 Fastify 无法启动。不要通过改成 `644` 解决权限问题。

内容如下：

```dotenv
# 只会把 VITE_ 前缀变量编译进浏览器包；Anon Key 本身可公开，权限靠 RLS。
VITE_SUPABASE_URL=https://zqddeeljxwfkguqugucg.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_API_URL=https://yingwutown.top

# 以下值仅供 Fastify 使用，绝对不要添加 VITE_ 前缀。
SUPABASE_URL=https://zqddeeljxwfkguqugucg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
API_HOST=127.0.0.1
API_PORT=8787
API_TRUST_PROXY=loopback
WEB_ORIGIN=https://yingwutown.top
STORAGE_CLEANUP_INTERVAL_MS=300000
STORAGE_CLEANUP_MAX_ATTEMPTS=8
STORAGE_CLEANUP_BATCH_SIZE=50
STORAGE_CLEANUP_RETRY_BASE_MS=30000
STORAGE_CLEANUP_RETRY_MAX_MS=3600000
ACCOUNT_CLEANUP_INTERVAL_MS=300000

# 可选隐私统计
ANALYTICS_IP_PEPPER=YOUR_OTHER_INDEPENDENT_RANDOM_32_PLUS_CHARACTER_SECRET
```

`API_TRUST_PROXY=loopback` 只信任同机 Nginx，并让登录限流读取真实客户端 IP。
不要把 Service Role Key 放入 Git、Nginx 配置或任何
`VITE_*` 变量。`ANALYTICS_IP_PEPPER` 使用独立随机密钥，例如 `openssl rand -hex 32`。

网站已移除 QQ 注册和绑定，不再读取 OneBot/NapCat 配置。独立机器人服务继续按自身配置运行。

## 4. Supabase 迁移

已有生产数据时，先按 §10.1 新清空工具流程完成工具内当次备份、独立库恢复验证及全上传对象清理，再执行本节 push；清空后按同小节生成新副本并替换此前副本。以下迁移命令本身不会自动备份。
按 2026-10-05 最新清空要求，迁移前必须完成 §10.1 的 `reset-business-storage.mjs` dry-run 及 `--apply` 全上传对象清理，不能直接跳到数据库 push。

必须按文件名顺序应用 `supabase/migrations/` 中的全部迁移。无论升级现有项目，
还是更换 Supabase 项目，都应在可信终端按迁移历史执行：

```bash
cd /opt/yingwu/source
read -rsp 'Supabase Access Token: ' SUPABASE_ACCESS_TOKEN
export SUPABASE_ACCESS_TOKEN
echo
pnpm dlx supabase@2.109.1 link --project-ref zqddeeljxwfkguqugucg
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db push --linked --dry-run
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
unset SUPABASE_ACCESS_TOKEN
```

先审查 dry-run 的全部待执行文件，再执行 push。确认本地与远端迁移号成对出现，lint 无 schema warning。迁移会建立 RLS、
Storage bucket、账号/文件清理队列与地图表；不要在生产库手工逐段复制 SQL。

新项目首个 Owner 通过 Service Role 管理入口创建，再执行一次角色初始化，步骤见 [Supabase 初始化](../supabase/README.md#首个-owner)。已有 Owner 不重复初始化。关闭 Email 公开注册，保留 Email/Password 登录；后续账号统一由 Owner 后台创建。

### 本次 QQ 清理与新项目状态

2026-10-07 核对旧生产项目仍停在 `20260820144733`，`202610040001/0002/0003` 和 `202610050001` 尚未执行；不要把新项目的状态当成旧生产数据状态。新 Supabase 项目 `zqddeeljxwfkguqugucg` 已导入账号、保留业务数据和 Storage 对象，QQ、资源与材料数据按退役规则排除。生产清空迁移 `202610050001` 本次不执行。

不要直接 `db push` 连带清空旧生产业务，也不要单独复制 QQ SQL 绕过迁移顺序。旧维护窗口按本章第 10 节处理；数据库和新版应用一起发布。新项目首个 Owner 需重新创建；迁移后账号、密码和角色保留，QQ 绑定数据删除。`schematics` bucket 只能在 Storage API 清理后删除，禁止直接删 Storage 表。

## 5. 构建并验收 release

让 Vite 读取生产变量，但不把配置复制进 Git 工作树：

```bash
ln -s /etc/yingwu/yingwu.env "$RELEASE/.env"
cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm audit --prod
pnpm exec playwright install --with-deps chromium
CI=1 pnpm test:e2e
```

`pnpm check` 已构建 Fastify 到 `dist-server/`，无需重复执行 `pnpm api:build`。`CI=1` 让 Playwright 使用已安装的 Chromium，而不是本地 Windows Edge。若生产机不允许安装浏览器，必须由同一 revision 的 CI 或可信构建机先完成 E2E，并记录验证结果后再切换。

成功后切换原子软链接：

```bash
ln -sfn "$RELEASE" /opt/yingwu/current
```

## 6. systemd 运行 Fastify

先确认 Node 的实际路径：

```bash
command -v node
```

创建 `/etc/systemd/system/yingwu-api.service`；若路径或用户不同，请替换：

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

启动并检查：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yingwu-api
sudo systemctl status yingwu-api --no-pager
curl --fail http://127.0.0.1:8787/health
```

预期健康响应：`{"ok":true,"service":"yingwu-api"}`。

## 7. Nginx 静态站点与反向代理

创建 `/etc/nginx/sites-available/yingwu`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yingwutown.top;

    root /opt/yingwu/current/dist;
    index index.html;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://wj.qq.com https://player.bilibili.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location ^~ /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8787/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        # 为 multipart 边界留余量，Fastify 仍严格限制文件本体为 50 MiB。
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

    location ~* \.(?:svg|png|jpg|jpeg|webp|gif|woff2)$ {
        expires 7d;
        try_files $uri =404;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/yingwu /etc/nginx/sites-enabled/yingwu
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS

```bash
sudo certbot --nginx -d yingwutown.top
sudo certbot renew --dry-run
```

Certbot 完成后，验证：

```bash
curl --fail https://yingwutown.top/health
curl -I https://yingwutown.top/
```

同时在 Supabase Dashboard 的 Authentication URL Configuration 中把 Site URL 设置为
`https://yingwutown.top`，并加入同域 Redirect URL。

## 9. 发布更新

每次 GitHub 更新后，在服务器执行：

```bash
set -Eeuo pipefail

cd /opt/yingwu/source
git fetch --prune origin
REV="$(git rev-parse origin/main)"
RELEASE="/opt/yingwu/releases/${REV}-$(date +%Y%m%d%H%M%S)"
git worktree add --detach "$RELEASE" "$REV"
ln -s /etc/yingwu/yingwu.env "$RELEASE/.env"
cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm audit --prod
CI=1 pnpm test:e2e

# Supabase link state lives under source/supabase/.temp, not in a release worktree.
cd /opt/yingwu/source
read -rsp 'Supabase Access Token: ' SUPABASE_ACCESS_TOKEN
export SUPABASE_ACCESS_TOKEN
echo
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db push --linked --dry-run
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
unset SUPABASE_ACCESS_TOKEN

sudo chmod -R a+rX "$RELEASE"
ln -sfn "$RELEASE" /opt/yingwu/current
sudo systemctl restart yingwu-api
sudo nginx -t && sudo systemctl reload nginx
curl --fail https://yingwutown.top/health
```

只有所有检查成功后才切换 `current`，因此构建失败不会影响线上版本。

## 10. 回滚、日志与日常检查

查看已有 release：

```bash
ls -1 /opt/yingwu/releases
readlink -f /opt/yingwu/current
```

验收新 release 前可以切回尚未清理且与当前 schema 兼容的目录；验收成功并清理旧副本后，没有旧目录可切回。删除业务表的迁移不可通过代码回滚恢复。

在目录仍保留且确认兼容时：

```bash
ln -sfn /opt/yingwu/releases/PREVIOUS_RELEASE /opt/yingwu/current
sudo systemctl restart yingwu-api
sudo nginx -t && sudo systemctl reload nginx
```

日志与健康检查：

```bash
sudo journalctl -u yingwu-api -n 200 --no-pager
sudo journalctl -u yingwu-api -f
sudo tail -n 200 /var/log/nginx/error.log
systemctl is-active yingwu-api nginx
curl --fail https://town.example.com/health
```

Supabase 是持久数据源；源码 release 不包含数据库或用户上传文件。只保留最新一份经过恢复验证的加密副本；新副本验证成功后替换上一份，失败保留旧副本。数据库备份不包含 Storage 物理文件，必须同步保存 `site-images` 与 `town-maps`。托管备份/PITR按照平台实际能力核查，不能把本地清理等同于平台全部清除。

### 10.1 backup-current 备份与恢复验证

**状态：真实生产备份与恢复尚未运行。** 以下是待执行操作说明，不是已完成记录。涉及删除数据的迁移前，先完成备份和独立库恢复验证；失败时停止迁移，不替换当前备份。

工具为 `scripts/backup-current.mjs`，使用项目已有 Node 依赖。Node 仍须 `>=22.22.0`，从 [Node.js 官方下载页](https://nodejs.org/en/download) 安装；PostgreSQL 客户端从 [官方 Ubuntu PGDG 入口](https://www.postgresql.org/download/linux/ubuntu/) 安装。配置 PGDG 后可安装 `postgresql-client-17`，不必在生产 Web 服务器安装数据库服务：

```bash
sudo apt update
sudo apt install -y postgresql-client-17
/usr/lib/postgresql/17/bin/pg_dump --version
/usr/lib/postgresql/17/bin/pg_restore --version
/usr/lib/postgresql/17/bin/psql --version
```

两者必须为 17 或更新版本，`pg_restore` 主版本不能低于 `pg_dump`；源服务器若高于 17，应选择与源兼容的客户端并调整路径。准备独立验证库时使用兼容源库的服务器版本，事先创建归档引用的角色、扩展和 Supabase 依赖；例如 `anon`、`authenticated`、`service_role`、`supabase_auth_admin`、`supabase_storage_admin`，具体清单以源库实际依赖为准。

验证库不是普通空库即可：脚本不导出全局角色，不创建数据库，`--no-owner` 只跳过对象所有者恢复，ACL/RLS/函数仍可能依赖角色与扩展。缺失这些依赖会导致恢复失败。脚本会执行 [`pg_restore`](https://www.postgresql.org/docs/17/app-pgrestore.html) 的 `--clean --if-exists --exit-on-error --single-transaction --no-owner`，覆盖验证库内归档涉及的对象。只能使用独立、可丢弃的验证库，不能填写源生产库或其他业务库。

源库和验证库名均只接受 `/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/` 字面库名，拒绝 conninfo、连接 URI 和额外连接参数，防止 PostgreSQL 客户端重新解释目标。`PG_PSQL_PATH` 配置时必须是同一套 PostgreSQL 17+ 安装的 `psql` 绝对路径；省略时使用 `PG_DUMP_PATH` 同目录的 `psql`（Windows 为 `psql.exe`），不会跳过身份检查。脚本分别查询源与验证连接的 `pg_control_system().system_identifier`，核对真实 cluster ID，同时读取 `inet_server_addr()`、`inet_server_port()`、`current_database()` 的实际 backend 信息。**源与验证必须属于不同 cluster ID**；同 ID 时即使数据库名、地址或端口不同也拒绝。恢复前再次查询、比对身份；函数执行、连接、权限或解析失败均停止，不降级为 host + database 或仅 URL 比较。

运维应预先为源库实际连接角色、验证库角色准备 `pg_control_system()` 的只读 EXECUTE 权限；工具不会自动 GRANT 或放宽权限。验证库必须位于独立 cluster 且可丢弃，仍需核对 DNS/代理并防止核验与恢复之间的连接目标切换。生产只读连接已验证该函数可执行，但 linked dump 临时角色是否可执行尚未经过真实备份验证；这不是生产备份与恢复已完成的证据。

为受信任备份执行账号创建 `/etc/yingwu/backup.env`，限制为该账号或其受信任组可读。不要把文件放入 Git 或把秘密写入 cron。配置示例：

沿用本文的部署账号 `ubuntu` 和秘密组时，首次准备专用空目录及配置文件（账号替换为实际值）：

```bash
sudo install -d -m 700 -o ubuntu -g ubuntu /var/lib/yingwu-backups
sudo nano /etc/yingwu/backup.env
sudo chown root:yingwu-secrets /etc/yingwu/backup.env
sudo chmod 640 /etc/yingwu/backup.env
```

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
BACKUP_DIRECTORY=/var/lib/yingwu-backups
# 常规范围；退役维护前一次性改为 site-images,town-maps,schematics。
BACKUP_BUCKETS=site-images,town-maps
PG_DUMP_PATH=/usr/lib/postgresql/17/bin/pg_dump
PG_RESTORE_PATH=/usr/lib/postgresql/17/bin/pg_restore
PG_PSQL_PATH=/usr/lib/postgresql/17/bin/psql
BACKUP_VERIFY_DATABASE_URL=postgresql://VERIFY_USER:URL_ENCODED_PASSWORD@VERIFY_HOST:5432/samstown_backup_verify?sslmode=require
BACKUP_ENCRYPTION_KEY=YOUR_64_HEX_CHARACTER_KEY
# 可选：省略时从 PATH 查找 supabase；必须是实际可执行文件路径。
BACKUP_SUPABASE_CLI_PATH=/usr/local/bin/supabase
BACKUP_COMMAND_TIMEOUT_MS=1800000
```

- 密钥要求 64 位十六进制；可在可信终端一次性生成并安全保存，与备份目录分开保管。已有备份后不能直接更换密钥，否则归属签名和解密校验会失败。
- URL 密码中的特殊字符须 URL 编码；验证库 URL 只支持 `sslmode` 查询参数，省略时默认 `require`。仅本机隔离测试库可按实际情况显式选择 `disable`。
- `BACKUP_DIRECTORY` 必须是工作树、家目录以外的专用绝对路径，不能是根目录或包含它们的祖先目录，任何路径节点不得为链接。首次使用需为空或不存在；非空且缺少本工具签名归属标记时拒绝接管。
- 安装可直接执行的 Supabase CLI，确保执行账号已有登录及 linked 连接所需凭据。只有 `pnpm dlx` 临时调用可用时，需先准备实际 CLI 可执行路径，不能把带参数的命令字符串填入路径键。

在保有 linked 状态的 source checkout 安装依赖并运行；不要从未 linked 的 release worktree 执行：

```bash
cd /opt/yingwu/source
pnpm install --frozen-lockfile
node --env-file=/etc/yingwu/backup.env scripts/backup-current.mjs
```

执行账号须能读配置和 linked 状态、连接源库与验证库，并写入专用备份目录。脚本核对 `supabase/.temp/project-ref` 与 `SUPABASE_URL`，当前仅支持标准 Supabase 项目域名；通过 `supabase db dump --linked --dry-run` 解析连接字段，不执行其输出。不要把连接输出或环境文件打印到日志。

备份流程和验证范围：

1. 导出 `public`、`private`、`auth`、`storage`、`supabase_migrations` 五个 schema 的 custom 归档，流式加密为 `database.enc`。
2. 下载 `BACKUP_BUCKETS` 范围内的全部对象，逐文件 AES-256-GCM 加密；默认 `site-images,town-maps`，遇到范围外 bucket 拒绝继续。Storage metadata 也加密保存。
3. 解密数据库归档并实际恢复到独立验证库；比较 Storage 前后 metadata，校验加密文件 SHA256 和签名 manifest 后发布。
4. 原子替换 `BACKUP_DIRECTORY/current`，完成备份目录 fsync 后，再精确核验并删除上一份本工具管理的备份。

`current` 是签名 JSON **索引文件**，指向同目录的 `backup-UUID/`；不是软链接，也不同于应用的 `/opt/yingwu/current`。不要手工改索引、归属标记、manifest 或目录名。发布前任一步失败都保留旧索引和旧副本；若新索引已发布但旧副本清理失败，脚本报“新 current 已发布”，旧副本可能仍在，需先核对再处理，不能把该次运行当作全部完成。

替换索引后目录 fsync 是清理旧副本的前置条件。平台不支持目录同步或同步失败时，新 `current` 可能已经发布，但旧副本不清理，工具报告失败。应核对索引和副本状态，处理文件系统持久化问题；不得手工删除旧副本来绕过该失败。

工具只删除上一份索引指向、项目归属与签名匹配、manifest 清单和摘要通过核验的 managed 备份，不扫描清空备份根目录。未知文件、未登记副本、外部历史备份、其他目录和托管备份/PITR 都不在自动删除范围。外部历史需另列精确绝对路径、核验归属及当前恢复能力后单独清理；不得用通配符或递归清空目录代替核验。

成功提示仅证明本次数据库独立库恢复及 Storage 快照/文件校验通过，**不证明生产恢复或 Storage 重新上传恢复已演练**。当前工具没有独立恢复命令；完整灾难恢复演练还需核对角色、扩展、Auth、RLS、Storage 物理文件与元数据的恢复配合。

#### 保留账号、清空其他运行数据：先验证备份，再清空

以下为之前留下的全量清空维护方案，尚未真实执行，本次代码精简不执行它。该旧方案覆盖全部业务表与本项目上传文件，不再保护旧业务共享媒体。全量清空迁移自身保留整个 Auth、`public.profiles`、`private.qq_identities`；后续 QQ 退役迁移才删除 QQ 专属数据和字段。账号、密码、角色、RLS 和系统配置保留。

1. 进入维护窗口，停止 API、业务写入、上传、清理 worker 和备份 timer/cron；准备 PG17+ 客户端与独立可丢弃恢复库。
2. 执行下面的默认 dry-run，核对 linked 项目、完整 public/private 基表目录和三个已知 bucket；未知表或 bucket 阻止继续。工具通过 Supabase CLI Management API 查询 pg_catalog；配置 CLI 绝对路径或确认 PATH 可用，且 CLI 登录仍有效。OpenAPI 检查仅作辅助，不能替代完整目录。
   物化视图、外部表、分区结构也按未知持久对象阻断。若旧退役迁移尚未应用，工具还会预检存活业务中的投影引用；出现 `pending-retirement-sequence-precondition-failed` 时，在备份/删除前停止。先核对冲突引用并另行制定可恢复的数据处理，不跳过历史迁移，不盲删文件。此类状态尚不支持一键清空。
   同时预检地图 claim/cell 归属、业务继承结构、启用的 TRUNCATE 触发器及业务清空的外部外键依赖；发现已知迁移阻断条件时，在首次文件删除前停止。每批校验只允许当前已确认批次消失，其他对象消失、新增或版本变化均停止。
3. 使用备份环境文件及 `DATA_RESET_MAINTENANCE_WINDOW=confirmed` 执行 `--apply`。工具强制备份 `site-images,town-maps,schematics`，先完成当次加密备份与隔离库恢复验证，再通过 Storage API 分批删除全部上传对象。对象变化或删除未确认时停止。
4. 确认 Storage 空后按 §4 CLI 顺序应用全部待执行迁移。新增 `202610050001` 拒绝残留对象及未知 public/private 业务表，使用 RESTRICT 清空其余业务表，并核对账号身份数据前后完全相同。不能跳过旧迁移或手工挑 SQL。
5. 先核对全量清空后的账号、密码和角色，随后按序 QQ 退役会删除已有绑定；业务表与上传对象按旧方案清空。使用默认 `BACKUP_BUCKETS=site-images,town-maps` 和原密钥生成清空后的验证副本；只有发布与 fsync 成功后，才清理 managed 旧副本。外部备份、验证库残留、旧 release 和托管副本仍需精确核对归属。
6. 核验最新副本后，人工核对并解除一次性 `supabase/.temp/business-reset-operation.json` 标记，才恢复业务写入和定时备份。日志记录 prepared、备份已验证或 Storage 已空/迁移待执行阶段；中断后禁止重跑清理或备份覆盖原始完整副本，先恢复或完成当前维护。

清空脚本从 source 的 `.env` 读取配置，进程环境优先，同时核对 linked 项目和生成数据库类型。确认 source 使用正确生产配置，已有文件不覆盖；备份专用环境由 Node `--env-file` 加载，不打印连接字符串或秘密。

```bash
cd /opt/yingwu/source
node scripts/reset-business-storage.mjs
```

不加参数就是 dry-run，当前不接受 `--dry-run`。审查报告后再执行：

```bash
DATA_RESET_MAINTENANCE_WINDOW=confirmed node --env-file=/etc/yingwu/backup.env scripts/reset-business-storage.mjs --apply
```

只在 apply 成功后执行 §4 的 `migration list --linked` → `db push --linked --dry-run` → 审查完整待执行顺序 → `db push --linked` → `migration list --linked` / `db lint --linked`。任一步失败均停止；不能手工挑选 SQL，也不能用直接删除 `storage.objects` 元数据代替 Storage API 删除物理对象。

该顺序只保证本工具管理目录的新副本来自退役后的存活数据。独立验证库若残留归档范围外的旧对象，也需按精确对象清单单独核验处理；`pg_restore --clean` 不会自动清空整个验证库。外部历史备份和托管 PITR 仍需单独盘点与清理，不能据此宣称所有位置的退役数据已删除。

工具不内置调度。首次人工运行和恢复验证成功后，自行通过 cron 或 systemd timer 安排；cron 必须使用同一受信任账号、绝对 Node 路径和 linked 工作目录。例如确认 Node 路径为 `/usr/bin/node` 后：

```cron
0 3 * * * cd /opt/yingwu/source && /usr/bin/node --env-file=/etc/yingwu/backup.env scripts/backup-current.mjs
```

按实际负载选择执行时间，并配置 cron 输出收集和失败通知。此示例未安装任何定时任务。

## GitHub Actions

普通 CI 只验证类型、lint 和精简测试；手动 workflow 勾选 `release` 后执行完整验证，不发布站点。React 与 Fastify 始终由
本章的 Ubuntu/Nginx 同域方案部署，避免额外的 CORS、路由和版本同步问题。
