# 部署

Ubuntu 24.04；生产域名 `yingwutown.top`。Nginx 托管前端，Fastify 只监听本机。已有部署直接从“更新”开始。

## 当前 2GB 服务器部署约定

- 本机完成前端与 API 构建，上传 `dist/`、`dist-server/` 及同一提交的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`；不上传 Windows `node_modules` 或明文环境文件。
- 服务器执行 `pnpm install --prod --frozen-lockfile`，保留原依赖声明与覆盖配置，不重新生成锁文件，以免构建与运行使用不同依赖。
- 服务器只安装生产依赖。安装任务使用 systemd 临时单元限制 `CPUQuota=50%`、`MemoryMax=448M`，不运行 `release:check`。
- 路径统一 `/opt/samstownweb/releases/<版本>-<日期>`、`/opt/samstownweb/current`、`/etc/samstownweb.env`；服务 `samstownweb-api`。
- 实际 Supabase 项目以 `.env` 的 URL 为准，必须同时核对 CLI linked 项目，不能把旧项目迁移盘点误当作新项目状态。
- 新项目保留现有账号及 Storage；不重放初始化、清空或退役脚本。迁移历史时间戳与仓库可能不同，不能盲目 `db push`。
- 以下为源码式部署参考；完整检查在本机或 CI 执行，不在小内存生产机执行。

## 1. 准备环境与源码

安装 [Node.js](https://nodejs.org/en/download) `>=22.22.0`（可选 24 LTS）和项目固定的 [pnpm](https://pnpm.io/installation) `11.9.0`。不要直接用 `pnpm@latest` 替代锁定版本。

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nginx certbot python3-certbot-nginx
sudo npm install -g pnpm@11.9.0
node --version
pnpm --version
ssh -T git@github.com
```

私有仓库需先把服务器 SSH 公钥加入 GitHub 的只读 Deploy key。不要把私钥放进仓库。

```bash
sudo install -d -m 755 -o "$(id -un)" -g "$(id -gn)" /opt/samstownweb /opt/samstownweb/source /opt/samstownweb/releases
git clone git@github.com:afterSuperSam/SamsTownWeb.git /opt/samstownweb/source
id samstownweb || sudo useradd --system --user-group --home-dir /var/lib/samstownweb --create-home --shell /usr/sbin/nologin samstownweb
# 环境文件直接放 /etc/samstownweb.env，不创建同名目录。
```

公网仅开放 SSH、80、443；8787、数据库与机器人管理端口不要开放。域名 A 记录指向服务器；未使用 IPv6 时不要保留错误的 AAAA 记录。

## 2. 生产环境变量

编辑 `/etc/samstownweb.env`：

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_API_URL=https://yingwutown.top
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
API_HOST=127.0.0.1
API_PORT=8787
API_TRUST_PROXY=loopback
WEB_ORIGIN=https://yingwutown.top
ANALYTICS_IP_PEPPER=YOUR_INDEPENDENT_RANDOM_32_PLUS_CHARACTER_SECRET
```

```bash
sudo chown root:samstownweb /etc/samstownweb.env
sudo chmod 640 /etc/samstownweb.env
```

构建账号必须能读取该文件；非 root 部署用户可加入 `samstownweb` 组后重新登录。不要改为公开可读。更多可选配置见 `.env.example` 和 `server/config.ts`。`VITE_*` 会进入浏览器，不能放 Service Role Key；修改它们后必须重新构建。

Supabase 关闭公开注册，保留 Email/Password 登录；Site URL 和 Redirect URL 使用站点 HTTPS 地址。已有账号和管理（数据库角色 owner）不重新初始化。

## 3. 固定版本与数据库

每次发布先固定提交，迁移盘点和构建均在同一个 release 中完成。下面在同一终端执行；只调整父目录归属，不递归更改环境目录权限。按 [官方迁移流程](https://supabase.com/docs/guides/deployment/database-migrations)盘点：

```bash
sudo chown "$(id -un):$(id -gn)" /opt/samstownweb
cd /opt/samstownweb/source
git fetch --prune origin
REV="$(git rev-parse origin/main)"
RELEASE="/opt/samstownweb/releases/${REV}-$(date +%Y%m%d%H%M%S)"
git worktree add --detach "$RELEASE" "$REV"
ln -s /etc/samstownweb.env "$RELEASE/.env"
cd "$RELEASE"
pnpm dlx supabase@2.109.1 login
pnpm dlx supabase@2.109.1 link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db push --linked --dry-run
pnpm dlx supabase@2.109.1 db lint --linked --level warning
```

**仓库包含 `202610050001_reset_business_data_keep_accounts.sql` 业务清空迁移。** 正常发布只盘点，不自动 push。待执行列表包含清空、Storage 清理前置或历史版本不一致时停止，先核对基线及可恢复备份；不要手工挑 SQL、删旧迁移或使用 `--include-all` 绕过检查。

只有已审查、备份验证通过的维护窗口才在该 release 执行 `db push --linked`。新建数据库也需先确认这条完整迁移链适用。`20261018080615_retire_forum_and_manual_notices.sql` 会删除旧论坛与手动公告数据，需先备份；原论坛头图转入“其他”，不删除图片文件。浏览器仍不能直接写入 `profiles`。类型更新在本地进行：

```bash
pnpm dlx supabase@2.109.1 gen types typescript --linked > src/lib/database.types.ts
```

首个 Owner 仅在没有 Owner 的新部署创建。在可信终端设置 `BOOTSTRAP_EMAIL`、`BOOTSTRAP_PASSWORD` 后，使用服务器依赖执行以下一次性初始化；不要在前端运行或把密码写入源码：

```bash
cd "$RELEASE"
pnpm install --frozen-lockfile
read -rp 'Owner email: ' BOOTSTRAP_EMAIL
read -rsp 'Owner temporary password: ' BOOTSTRAP_PASSWORD
export BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
node --env-file=/etc/samstownweb.env --input-type=module <<'JS'
import { createClient } from '@supabase/supabase-js';
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await client.auth.admin.createUser({
  email: process.env.BOOTSTRAP_EMAIL, password: process.env.BOOTSTRAP_PASSWORD, email_confirm: true,
  app_metadata: { yingwu_trusted_provisioning: true }, user_metadata: { username: 'DogSam' }
});
if (error) throw error;
const result = await client.from('profiles').update({ role: 'owner' }).eq('id', data.user.id).select('id').single();
if (result.error) throw result.error;
JS
unset BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
```

## 4. 构建 release

在本机或 CI 对固定的源码快照构建，不再次拉取分支。任一步失败停止，不切换当前版本。2GB 生产服务器不要执行本节完整验证命令。

```bash
cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
CI=1 pnpm release:check
```

生成 `dist/` 和 `dist-server/`。先完成数据库盘点、构建与浏览器验证，再切换版本；数据库与代码需兼容。CLI linked 状态留在该 release 的忽略目录中，不提交到 Git。

## 5. Fastify 服务

创建 `/etc/systemd/system/samstownweb-api.service`。用 `command -v node` 确认 `ExecStart` 的实际路径；Node 必须位于服务账号可访问的系统目录。

```ini
[Unit]
Description=Yingwu Town API
After=network-online.target
Wants=network-online.target

[Service]
User=samstownweb
Group=samstownweb
WorkingDirectory=/opt/samstownweb/current
Environment=NODE_ENV=production
EnvironmentFile=/etc/samstownweb.env
ExecStart=/usr/local/bin/node dist-server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```bash
ln -sfn "$RELEASE" /opt/samstownweb/current
sudo systemctl daemon-reload
sudo systemctl enable --now samstownweb-api
curl --fail http://127.0.0.1:8787/health
```

## 6. Nginx 与 HTTPS

创建 `/etc/nginx/sites-available/samstownweb`：

```nginx
server {
    listen 80;
    server_name yingwutown.top;
    root /opt/samstownweb/current/dist;
    index index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://wj.qq.com https://player.bilibili.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" always;
    location / { try_files $uri $uri/ /index.html; }
    location = /index.html { expires -1; }
    location /assets/ { expires 1y; try_files $uri =404; }
    location ~ ^/(api/|health$) {
        client_max_body_size 52m;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/samstownweb /etc/nginx/sites-enabled/samstownweb
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d yingwutown.top
curl --fail https://yingwutown.top/health
```

确保服务账号和 Nginx 可读取 release；环境文件权限保持不变。博客是独立站点，需另设 `blog.yingwutown.top` DNS、Nginx 和证书；网页页脚链接不会替你部署博客。

## 更新、回滚与排错

更新：按第 3 节创建固定版本的 release 并盘点数据库，再执行第 4 节构建；保存 `readlink -f /opt/samstownweb/current` 的旧路径。第 1 节已将父目录授予部署用户，切换链接无需修改环境文件权限。验证成功后：

```bash
ln -sfn "$RELEASE" /opt/samstownweb/current
sudo systemctl restart samstownweb-api
sudo nginx -t && sudo systemctl reload nginx
curl --fail https://yingwutown.top/health
```

再验证：首次改密后可立即打开受限页面；首页事务告知最多展示最新 3 篇博客文章；320px 窄屏中英文布局及浅色改密提示正常。

博客默认读取 `https://blog.yingwutown.top/api/public/site-card.json`，Fastify 缓存 5 分钟。服务器需能出站访问博客 HTTPS；更换博客地址使用 `BLOG_API_URL`，重启 API 即可，不需要开放新端口或修改浏览器跨域规则。同步故障查看 API 日志中的 `Blog feed refresh failed`。

账号门禁迁移 `20261018155301_enforce_profile_password_gate.sql` 不清空数据，按第 3 节盘点后顺序应用。服务保持单 Fastify 进程；扩为多实例前需替换账号更改的进程内串行控制。

v2.2.0 需同步应用 `20261020041649_simplify_roles_and_map_projects.sql`：原 viewer/admin 账号归并为成员，owner 保留为管理；地图标记、项目状态及相关旧 RPC 被删除。现有项目区块和建造者保留。先备份数据库，再在维护窗口按 CLI 顺序迁移并同时切换前后端；旧前端不兼容新 RPC，不能只切换静态文件。角色归并与标记删除不可用简单代码回滚恢复。

回滚：将 `current` 指回已保留且兼容当前数据库的旧 release，重启 API。代码回滚不能撤销破坏性数据库迁移。

- API 失败：`systemctl status samstownweb-api --no-pager`、`journalctl -u samstownweb-api -n 80 --no-pager`。
- 登录／后台失败：先检查 `/health`、当前服务工作目录、生产变量及数据库 RLS；不要打印密钥。
- 页面旧版：检查 Nginx root、`current`、浏览器缓存；`VITE_*` 改后重新构建。
- 上传失败：核对 52m Nginx 限制、Fastify 文件与解码限制、Storage policy。
- 清理旧 release 前先核对其绝对路径和回滚用途，使用 `git worktree remove`，不要清空 releases 根目录。

## 备份

数据库备份与 Storage 文件必须分别覆盖，并验证可恢复性。可用独立工具 `scripts/backup-current.mjs`：配置见 `.env.example` 的 `BACKUP_*` 与 `PG_*`，需要 PG17+ 客户端、已 linked 的 release、独立验证库、专用目录及独立加密密钥。

```bash
cd /opt/samstownweb/current
node --env-file=/etc/samstownweb-backup.env scripts/backup-current.mjs
```

工具验证隔离库恢复及 Storage 文件校验，不等于生产恢复演练；不要丢失加密密钥。`reset-business-storage.mjs` 和 `retire-storage.mjs` 是破坏性维护工具，不属于发布流程，不要作为更新命令执行。
