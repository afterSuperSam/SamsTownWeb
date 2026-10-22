# Ubuntu 24 生产部署

推荐拓扑是同一域名下由 Nginx 提供 React 静态文件，并把 `/api` 与 `/health`
反向代理到仅监听 `127.0.0.1:8787` 的 Fastify。这样登录、50 MB 地图上传和
限流都不需要额外的跨域配置。

```text
Browser -> HTTPS/Nginx -> /                 React dist/
                       -> /api, /health     Fastify/systemd -> Supabase
```

以下示例使用：

- 域名：`town.example.com`（请全部替换）
- Linux 部署用户：`ubuntu`（请替换为实际 SSH 用户）
- 项目：`git@github.com:SuperSamWasHere/SamsTownWeb.git`
- 安装目录：`/opt/yingwu`

## 1. 部署前检查

先把域名 A/AAAA 记录指向服务器，然后验证现有工具：

```bash
node --version              # 必须 >= 22.22
git --version
ssh -T git@github.com       # 应识别出你的 GitHub 账号
```

启用项目固定的 pnpm 版本，并安装系统服务：

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx rsync
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Fastify 使用不可登录的专用账号，禁止以 root 运行公网服务。
id -u yingwu >/dev/null 2>&1 || sudo useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin yingwu
```

## 2. 克隆源码

```bash
sudo mkdir -p /opt/yingwu/source /opt/yingwu/releases /etc/yingwu
sudo chown -R ubuntu:ubuntu /opt/yingwu
git clone git@github.com:SuperSamWasHere/SamsTownWeb.git /opt/yingwu/source
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

创建只允许 root 与部署用户读取的配置：

```bash
sudo nano /etc/yingwu/yingwu.env
sudo chown root:yingwu /etc/yingwu/yingwu.env
sudo chmod 640 /etc/yingwu/yingwu.env
```

内容如下：

```dotenv
# 只会把 VITE_ 前缀变量编译进浏览器包；Anon Key 本身可公开，权限靠 RLS。
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_API_URL=https://town.example.com

# 以下值仅供 Fastify 使用，绝对不要添加 VITE_ 前缀。
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
API_HOST=127.0.0.1
API_PORT=8787
API_TRUST_PROXY=loopback
WEB_ORIGIN=https://town.example.com
STORAGE_CLEANUP_INTERVAL_MS=300000
ACCOUNT_CLEANUP_INTERVAL_MS=300000

# QQ 注册：OneBot/NapCat HTTP 端口必须只监听宿主机回环地址。
BOT_API_URL=http://127.0.0.1:3000
BOT_API_KEY=YOUR_RANDOM_ONEBOT_ACCESS_TOKEN
QQ_CODE_PEPPER=YOUR_INDEPENDENT_RANDOM_32_PLUS_CHARACTER_SECRET
```

`API_TRUST_PROXY=loopback` 只信任同机 Nginx，并让登录限流读取真实客户端 IP。
不要把 Service Role Key 放入 Git、Nginx 配置或任何
`VITE_*` 变量。`BOT_API_KEY` 与 `QQ_CODE_PEPPER` 必须分别随机生成，不能复用。
例如可分别执行两次 `openssl rand -hex 32`。

NapCat 的 OneBot HTTP 服务应映射为 `127.0.0.1:3000:3000`，并把其访问令牌设置为
与 `BOT_API_KEY` 相同的值。不得使用 `0.0.0.0:3000:3000`，也不要把 NapCat WebUI
地址写入 `BOT_API_URL`。

## 4. Supabase 迁移

必须按文件名顺序应用 `supabase/migrations/` 中的全部迁移。无论升级现有项目，
还是更换 Supabase 项目，都应在可信终端按迁移历史执行：

```bash
cd /opt/yingwu/source
export SUPABASE_ACCESS_TOKEN='YOUR_PERSONAL_ACCESS_TOKEN'
pnpm dlx supabase@2.109.1 link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
unset SUPABASE_ACCESS_TOKEN
```

确认本地与远端迁移号成对出现，lint 为 `No schema errors found`。迁移会建立 RLS、
Storage bucket、账号/文件清理队列与地图表；不要在生产库手工逐段复制 SQL。

新 Supabase 项目还需要在 Dashboard 的 Authentication 中先创建一个用户，再用该
用户 UUID 执行以下一次性 SQL，建立首个 Owner：

```sql
update public.profiles
set username = 'DogSam', role = 'owner', must_change_password = false
where id = 'AUTH_USER_UUID';
```

已有 Owner 的项目不要重复执行。后续账号可由 Owner 从后台创建，或由用户完成 QQ
私聊验证后自助创建 Viewer 账号。

创建首个 Owner 后，立即在 Supabase Dashboard 的 **Authentication → Providers → Email**
关闭“Allow new users to sign up”（允许新用户注册），并保持 Email/Password 登录开启。
网站的 QQ 注册由 Fastify 使用 Service Role 完成；关闭该开关可以阻止访客绕过
验证码流程直接调用 Supabase 注册接口。Owner 后台创建和 QQ 验证注册均不受此开关
影响。若 Dashboard
提供密码强度设置，请把最小长度设为至少 10 个字符，与网站校验保持一致。

## 5. 构建并验收 release

让 Vite 读取生产变量，但不把配置复制进 Git 工作树：

```bash
ln -s /etc/yingwu/yingwu.env "$RELEASE/.env"
cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm audit --prod
pnpm build
pnpm api:build
```

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
    server_name town.example.com;

    root /opt/yingwu/current/dist;
    index index.html;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.modrinth.com https://api.github.com; frame-src https://wj.qq.com https://player.bilibili.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests" always;
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
sudo certbot --nginx -d town.example.com
sudo certbot renew --dry-run
```

Certbot 完成后，验证：

```bash
curl --fail https://town.example.com/health
curl -I https://town.example.com/
```

同时在 Supabase Dashboard 的 Authentication URL Configuration 中把 Site URL 设置为
`https://town.example.com`，并加入同域 Redirect URL。

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
pnpm test
pnpm audit --prod
pnpm build
pnpm api:build

# Supabase link state lives under source/supabase/.temp, not in a release worktree.
cd /opt/yingwu/source
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning

sudo chmod -R a+rX "$RELEASE"
ln -sfn "$RELEASE" /opt/yingwu/current
sudo systemctl restart yingwu-api
sudo nginx -t && sudo systemctl reload nginx
curl --fail https://town.example.com/health
```

只有所有检查成功后才切换 `current`，因此构建失败不会影响线上版本。

## 10. 回滚、日志与日常检查

查看已有 release：

```bash
ls -1 /opt/yingwu/releases
readlink -f /opt/yingwu/current
```

回滚只需把软链接切回上一个已验证目录：

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

Supabase 是持久数据源；源码 release 不包含数据库或用户上传文件。仍应在 Supabase
控制台配置数据库备份，并定期验证 Storage、RLS 与 Auth 恢复流程。

## GitHub Actions

仓库的 CI 只验证类型、测试、依赖和生产构建，不发布站点。React 与 Fastify 始终由
本章的 Ubuntu/Nginx 同域方案部署，避免额外的 CORS、路由和版本同步问题。
