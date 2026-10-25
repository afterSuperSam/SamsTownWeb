# 部署

Ubuntu 24.04；生产域名 `moesam.com`。Nginx 托管前端，Fastify 只监听本机。已有部署直接从“更新”开始。

## 版本边界（2026-10-25）

- 发布版本：main v2.3.2 整合版，包含同域性能补丁以及原 main 的账号、地图、加载提示等改动；历史生产基线为 v2.2.5 / `a5334de`。
- 2026-10-25 发布前只读核验生产迁移历史及实际函数/策略：`20261024061030_align_upload_limits_and_usernames.sql` 已应用，用户名 Unicode 校验已存在、图片上限为 50MiB、三条旧公开策略已移除，因此此次不重复迁移。
- 新环境或后续版本仍必须先按第 3 节固定提交、盘点；不要把上述核验结论套到其他库，也不要重放清空/退役历史。推送 main 不是部署完成，只有产物、运行版本与访问验证通过后才能更新部署记录。

## 当前 2GB 服务器部署约定

- 本机完成前端与 API 构建，上传 `dist/`、`dist-server/` 及同一提交的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`；不上传 Windows `node_modules` 或明文环境文件。
- 本台还运行机器人等服务，不能仅凭进程的 CPU/内存上限判断整机余量足够。2026-10-25 在可用内存约 300MB 时安装依赖，出现整机内存压力及磁盘等待；今后不在这台生产机执行包管理器安装或完整检查。
- 依赖未变时可核对锁文件后复用已验证的 Linux 依赖；依赖变化时在独立 Linux 构建环境完成 `pnpm install --prod --frozen-lockfile`，保留完整清单/覆盖配置和原生模块，再传输验证过的 Linux 产物。不能上传 Windows 依赖、关闭供应链检查来加速，或悄悄重新生成锁文件。
- 路径统一 `/opt/samstownweb/releases/<版本>-<日期>`、`/opt/samstownweb/current`、`/etc/samstownweb.env`；服务 `samstownweb-api`。
- 实际 Supabase 项目以 `.env` 的 URL 为准，必须同时核对 CLI linked 项目，不能把旧项目迁移盘点误当作新项目状态。
- 新项目保留现有账号及 Storage；不重放初始化、清空或退役脚本。迁移历史时间戳与仓库可能不同，不能盲目 `db push`。
- 以下统一使用本地产物部署；完整检查在本机或 CI 执行，不在小内存生产机执行。旧 `dist/` 不可直接复用。

## 1. 准备环境与源码

安装 [Node.js](https://nodejs.org/en/download) `>=22.22.0`（可选 24 LTS）和项目固定的 [pnpm](https://pnpm.io/installation) `11.9.0`。不要直接用 `pnpm@latest` 替代锁定版本。

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nginx certbot python3-certbot-nginx
sudo npm install -g pnpm@11.9.0
node --version
pnpm --version
```

私有仓库在开发机克隆、验证和构建，生产服务器只接收产物，不需要 GitHub 私钥。不要把任何私钥放进仓库。

```bash
sudo install -d -m 755 -o "$(id -un)" -g "$(id -gn)" /opt/samstownweb /opt/samstownweb/releases
id samstownweb || sudo useradd --system --user-group --home-dir /var/lib/samstownweb --create-home --shell /usr/sbin/nologin samstownweb
# 环境文件直接放 /etc/samstownweb.env，不创建同名目录。
```

公网仅开放 SSH、80、443；8787、数据库与机器人管理端口不要开放。域名 A 记录指向服务器；未使用 IPv6 时不要保留错误的 AAAA 记录。

## 2. 生产环境变量

编辑 `/etc/samstownweb.env`：

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_API_URL=https://moesam.com
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
API_HOST=127.0.0.1
API_PORT=8787
API_TRUST_PROXY=loopback
WEB_ORIGIN=https://moesam.com
ANALYTICS_IP_PEPPER=YOUR_INDEPENDENT_RANDOM_32_PLUS_CHARACTER_SECRET
```

```bash
sudo chown root:samstownweb /etc/samstownweb.env
sudo chmod 640 /etc/samstownweb.env
```

不要把生产环境文件传回开发机或改为公开可读。在开发机的 `.env.production.local` 仅填写上述三个 `VITE_*` 公共值；生产服务端密钥保留在服务器。更多可选配置见 `.env.example` 和 `server/config.ts`。`VITE_*` 修改后必须重新构建。`SUPABASE_REQUEST_TIMEOUT_MS` 默认 15000，限制服务端上游请求等待时间。

Supabase 关闭公开注册，保留 Email/Password 登录；Site URL 和 Redirect URL 使用站点 HTTPS 地址。已有账号和管理（数据库角色 owner）不重新初始化。

## 3. 固定版本与数据库

每次发布先固定提交。以下在开发机的项目目录执行，确认工作区没有未提交修改；迁移盘点和构建之间不要切换提交。按 [官方迁移流程](https://supabase.com/docs/guides/deployment/database-migrations)盘点：

```bash
git status --short
git rev-parse HEAD
pnpm dlx supabase@2.109.1 login
pnpm dlx supabase@2.109.1 link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db push --linked --dry-run
pnpm dlx supabase@2.109.1 db lint --linked --level warning
```

**仓库包含 `202610050001_reset_business_data_keep_accounts.sql` 业务清空迁移。** 正常发布只盘点，不自动 push。待执行列表包含清空、Storage 清理前置或历史版本不一致时停止，先核对基线及可恢复备份；不要手工挑 SQL、删旧迁移或使用 `--include-all` 绕过检查。

只有待执行列表确认无误、备份验证通过的维护窗口，才从该固定提交执行 `pnpm dlx supabase@2.109.1 db push --linked`。新建数据库也需先确认完整迁移链适用。`20261018080615_retire_forum_and_manual_notices.sql` 会删除旧论坛与手动公告数据，需先备份；原论坛头图转入“其他”，不删除图片文件。浏览器仍不能直接写入 `profiles`。类型更新在本地进行：

```bash
pnpm dlx supabase@2.109.1 gen types typescript --linked > src/lib/database.types.ts
```

### 图片优化与首屏

v2.2.5 无需数据库迁移，前后端必须一起更新。新增 `/api/site/public/{content,images,members,faqs}` 和 `/api/site/media/<hash>.webp`，继续由现有 `/api/` 反代转发；旧 `/api/site/hero` 保留兼容但首屏不再使用。公开缓存使用 `SITE_PUBLIC_KEY`（未设置时读取 `VITE_SUPABASE_ANON_KEY`），只执行固定匿名 GET，不能填写 service-role/secret 密钥。

设置 `SITE_PUBLIC_CACHE_DIR=/var/lib/samstownweb/public-site`（环境文件或 systemd Environment 均可）。systemd 服务增加 `StateDirectory=samstownweb`、`StateDirectoryMode=0750`，让受 `ProtectSystem=strict` 保护的进程仅在自己的状态目录写入；缓存子目录 0700，归服务账号。已有服务建议使用 `samstownweb-api.service.d/public-cache.conf` drop-in，不覆盖其他设置。缓存按原子写持久化，切换 release 不清空。资料默认 30 秒刷新、故障最多使用 5 分钟旧结果；头图只镜像当前 Supabase 项目 `site-images` 公开桶里的 WebP。先预热四个公开接口及头图再切换静态文件，不上传 `.env` 或 Windows 依赖。回退时切回前一 release，状态目录可保留；不覆盖云端数据。

`site-init.js` 与应用共用同域缓存和同一头图 URL；开发环境 Vite 把这些公开路径转发至本地 8787。默认文案立即挂载，签名结束后不自动接收迟到文案，使用页面重试按钮恢复；1600 ms 签名与 500 ms 淡出保持不变。main 的 `initialContentWaitMilliseconds` 只限制文案自动接收窗口，不阻塞挂载，实际窗口取该配置与签名绘制时长的较小值。

v2.2.2 的图片与首屏优化不需要新迁移。部署时先更新 Fastify，再更新前端，确保 `/api/site/hero` 和 `/api/site/images` 可用；不要仅上传静态文件。Nginx 应启用下文的 gzip 与静态图片缓存，WebP 无需再次 gzip。`SITE_IMAGE_WEBP_QUALITY` 默认 90；上传请求等待时间由 `VITE_IMAGE_UPLOAD_TIMEOUT_MS` 控制，默认 120 秒。

历史 v2.2.3 将初始化合并为 `site-init.js`，当时文案和媒体直读 Supabase；当前 v2.2.5 及 main 已由前述同域缓存替代。完整替换 `dist` 并保留该脚本，不能继续使用旧的 `theme-init.js`、`hero-preload.js`；脚本不应设置一年缓存。构建时 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 必须正确，不能填入服务端密钥。无需 Google Fonts 域名；正文使用本机字体。

已有图片的优化在可信开发机执行，先查看测量结果再应用。脚本共用上传处理，不删除原图；原引用与结果写到系统临时目录并打印路径，需留存以便回溯。本次已有云端展示图已完成转换，不需要重复执行。打包时带上 `images/optimized` 生成的两档 WebP（构建会复制到 `dist`）；本地旧路径无需改数据库。

```powershell
node --env-file=.env --import tsx scripts/optimize-site-images.ts
node --env-file=.env --import tsx scripts/optimize-site-images.ts --apply
```

### 导入库的迁移时间戳不同

当前 SamsTownWeb 项目为 `zqddeeljxwfkguqugucg`，以本机 `.env` 的 URL 和 CLI 项目列表再次核对。该库导入时生成了新的历史时间戳，不能直接从仓库根目录执行 `db push`。不要修写云端历史、重放旧迁移或用 `--include-all`。在独立临时目录取回完整已应用基线，再加入评审过的新增迁移：

```powershell
$migrationWorkspace = Join-Path $env:TEMP ('samstownweb-migrations-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path "$migrationWorkspace/supabase" | Out-Null
Copy-Item supabase/config.toml "$migrationWorkspace/supabase/config.toml"
pnpm dlx supabase@2.109.1 link --project-ref zqddeeljxwfkguqugucg --workdir $migrationWorkspace
if ($LASTEXITCODE) { throw '项目关联失败' }
pnpm dlx supabase@2.109.1 migration fetch --linked --workdir $migrationWorkspace
if ($LASTEXITCODE) { throw '读取迁移基线失败' }
# 当前版本的增量；已应用时同名文件不会再次执行。
Copy-Item supabase/migrations/20261022124444_audit_integrity_fixes.sql "$migrationWorkspace/supabase/migrations/"
Copy-Item supabase/migrations/20261024061030_align_upload_limits_and_usernames.sql "$migrationWorkspace/supabase/migrations/"
pnpm dlx supabase@2.109.1 db push --linked --dry-run --workdir $migrationWorkspace
if ($LASTEXITCODE) { throw '迁移预演失败' }
```

人工核对输出仅含本次新迁移或没有待执行项，再在维护窗口执行以下命令。将来版本同样先评审新增列表，不要批量复制旧迁移到基线目录。

```powershell
pnpm dlx supabase@2.109.1 db push --linked --workdir $migrationWorkspace
if ($LASTEXITCODE) { throw '迁移失败，停止切换版本' }
pnpm dlx supabase@2.109.1 db lint --linked --schema public,private --level warning --fail-on error --workdir $migrationWorkspace
pnpm dlx supabase@2.109.1 migration list --linked --workdir $migrationWorkspace
```

首个 Owner 仅在没有 Owner 的新部署创建。**先完成第 4 节的产物上传和生产依赖安装**，再在服务器可信终端执行以下一次性初始化；不要在前端运行或把密码写入源码：

```bash
cd "$RELEASE"
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

## 4. 本机构建、准备 Linux 依赖与上传

开发机 Windows PowerShell：确认 `.env.production.local` 已填生产公共配置。任一步失败停止，不上传旧产物，不切换当前版本。完整验证只在准备发布时执行，2GB 生产服务器不要执行。

```powershell
pnpm install --frozen-lockfile
if ($LASTEXITCODE) { throw '安装失败' }
# 本地浏览器测试使用已安装的 Edge；CI 安装 Chromium。
pnpm release:check
if ($LASTEXITCODE) { throw '发布验证失败' }
$releaseName = (git rev-parse HEAD).Trim() + '-' + (Get-Date -Format yyyyMMddHHmmss)
$archive = Join-Path $env:TEMP "$releaseName.tar.gz"
tar -czf $archive dist dist-server package.json pnpm-lock.yaml pnpm-workspace.yaml scripts supabase/migrations supabase/config.toml
if ($LASTEXITCODE) { throw '打包失败' }
$deployHost = Read-Host 'SSH 用户@服务器'
scp $archive "${deployHost}:/tmp/"
if ($LASTEXITCODE) { throw '上传失败' }
Write-Host "服务器 release 名称：$releaseName"
```

若锁文件与现有 Linux 生产版一致，可以复用已验证的依赖。否则，在**独立 Linux 构建环境**（非生产 VPS，系统/架构、Node 大版本与生产一致）检出同一提交，保留原 package/lock/workspace 文件并执行：

```bash
pnpm install --prod --frozen-lockfile --ignore-scripts
node --input-type=module -e 'import Fastify from "fastify"; import sharp from "sharp"; console.log(Fastify().version, sharp.versions.sharp)'
# RELEASE_NAME 使用上一步相同的 <完整提交>-<时间戳>，不要另换源码或锁文件。
tar -czf "$RELEASE_NAME.linux-deps.tar.gz" node_modules
sha256sum "$RELEASE_NAME.linux-deps.tar.gz"
```

任一步失败停止，不跳过供应链校验或原生模块错误。把 Linux 依赖包传至生产 `/tmp/`，并通过可信构建输出核对 SHA256；它与 Windows 本机生成的前后端包分开。禁止打包实际 `.env`、CLI token、linked 状态或 Windows `node_modules`。

服务器 Bash：输入上一步输出的 release 名称，不带 `.tar.gz`。这里只解包、验证和关联已有依赖，**不运行任何包管理器安装**：

```bash
prepare_release() {
  read -rp 'Release 名称: ' RELEASE_NAME
  [[ "$RELEASE_NAME" =~ ^[0-9a-f]{40}-[0-9]{14}$ ]] || { echo '名称格式错误'; return 1; }
  RELEASE="/opt/samstownweb/releases/$RELEASE_NAME"
  test -f "/tmp/$RELEASE_NAME.tar.gz" || { echo '上传文件不存在'; return 1; }
  mkdir "$RELEASE" || return 1
  tar -xzf "/tmp/$RELEASE_NAME.tar.gz" -C "$RELEASE" || return 1
  cd "$RELEASE" || return 1
  PREVIOUS=$(readlink -f /opt/samstownweb/current 2>/dev/null || true)
  if test -n "$PREVIOUS" && test -d "$PREVIOUS/node_modules" \
    && cmp -s <(sed 's/\r$//' "$PREVIOUS/pnpm-lock.yaml") <(sed 's/\r$//' pnpm-lock.yaml); then
    ln -s "$(readlink -f "$PREVIOUS/node_modules")" node_modules || return 1
    echo '已复用同锁文件的 Linux 依赖；其真实目录仍被引用，不可清理。'
  else
    DEPS_ARCHIVE="/tmp/$RELEASE_NAME.linux-deps.tar.gz"
    test -f "$DEPS_ARCHIVE" || { echo '缺少经独立 Linux 环境验证的依赖包，停止'; return 1; }
    read -rp '独立 Linux 构建输出的依赖包 SHA256: ' DEPS_SHA256
    [[ "$DEPS_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
    printf '%s  %s\n' "$DEPS_SHA256" "$DEPS_ARCHIVE" | sha256sum -c - || return 1
    tar -xzf "$DEPS_ARCHIVE" -C "$RELEASE" node_modules || return 1
  fi
  node --input-type=module -e 'import Fastify from "fastify"; import sharp from "sharp"; console.log(Fastify().version, sharp.versions.sharp)' || return 1
  test -f dist/index.html && test -f dist-server/index.js
}
prepare_release
```

准备函数失败会立即返回，不退出 SSH，也不切换运行版本；须排除错误后再继续。先完成数据库盘点、本机验证、传输和 Linux 依赖核对，再切换版本。不要更改包依赖声明或生成另一份生产锁文件。进行临时 API 预检前确认整机内存/CPU/磁盘余量，并禁用清理 worker；检查结束关闭临时进程。单个进程有额度不代表整机不会受内存回收和 I/O 等待影响。

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
StateDirectory=samstownweb
StateDirectoryMode=0750
Environment=SITE_PUBLIC_CACHE_DIR=/var/lib/samstownweb/public-site

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
    server_name moesam.com;
    root /opt/samstownweb/current/dist;
    index index.html;
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://player.bilibili.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" always;
    location / { try_files $uri $uri/ /index.html; }
    location = /index.html { expires -1; }
    location /assets/ { expires 1y; try_files $uri =404; }
    location /images/optimized/ { expires 1y; try_files $uri =404; }
    location = /site-init.js { expires -1; try_files $uri =404; }
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
sudo certbot --nginx -d moesam.com
curl --fail https://moesam.com/health
```

确保服务账号和 Nginx 可读取 release；环境文件权限保持不变。博客是独立站点，需另设 `blog.moesam.com` DNS、Nginx 和证书；网页页脚链接不会替你部署博客。

## 更新、回滚与排错

已有站点需同步上面的 CSP：删除已停用的问卷与 Google Fonts 域名，保留 Bilibili 播放器。替换站点配置中的对应响应头后，运行 `sudo nginx -t && sudo systemctl reload nginx`，再用 `curl -I https://moesam.com/` 确认；只上传前端不会更新 Nginx 响应头。

更新：在开发机固定新提交，按第 3 节盘点数据库、第 4 节构建和上传；生产仅复用已验证的同锁依赖或解包独立 Linux 依赖包，不运行安装。记录 `readlink -f /opt/samstownweb/current` 的旧路径，不覆盖旧 release；预热公开资料与本地头图，确认 `$RELEASE` 指向本次已验证的新目录后：

```bash
ln -sfn "$RELEASE" /opt/samstownweb/current
sudo systemctl restart samstownweb-api
sudo nginx -t && sudo systemctl reload nginx
curl --fail https://moesam.com/health
```

再验证：首次改密后可立即打开受限页面；首页只展示最新一篇博客文章；公开地图能完整显示项目；后台保存和冲突提示正常；320px 窄屏中英文布局及浅色改密提示正常。

博客默认读取 `https://blog.moesam.com/api/public/site-card.json`，Fastify 缓存 5 分钟。服务器需能出站访问博客 HTTPS；更换博客地址使用 `BLOG_API_URL`，重启 API 即可，不需要开放新端口或修改浏览器跨域规则。同步故障查看 API 日志中的 `Blog feed refresh failed`。

账号门禁迁移 `20261018155301_enforce_profile_password_gate.sql` 不清空数据，按第 3 节盘点后顺序应用。服务保持单 Fastify 进程；扩为多实例前需替换账号更改的进程内串行控制。

v2.2.0 需同步应用 `20261020041649_simplify_roles_and_map_projects.sql`：原 viewer/admin 账号归并为成员，owner 保留为管理；地图标记、项目状态及相关旧 RPC 被删除。现有项目区块和建造者保留。先备份数据库，再在维护窗口按 CLI 顺序迁移并同时切换前后端；旧前端不兼容新 RPC，不能只切换静态文件。角色归并与标记删除不可用简单代码回滚恢复。

v2.2.1 依赖 `20261022124444_audit_integrity_fixes.sql`。先完成迁移，再切换本次前后端；它新增快照／冲突检查、会话失效判据、Storage 归属转移和事务清理队列，不清空业务数据。旧地图提交签名保留，避免共享数据库在切换 API 前中断旧版本。账号重置后的旧会话将被拒绝；服务端请求超时默认为 15 秒，可通过 `SUPABASE_REQUEST_TIMEOUT_MS` 调整。

main v2.3.2 部署前，按上述导入基线流程核对 `20261024061030_align_upload_limits_and_usernames.sql`；已应用就不重跑，只有待执行时才在独立维护窗口顺序应用，再更新前后端。2026-10-25 现有生产库已核验满足，原 v2.2.5 性能补丁本身不依赖此迁移。迁移统一用户名字符规则、将 `site-images` 上限设为 52428800 字节（50MiB），并删除三条退役游戏表的宽松策略；保留账号、图片和游戏表数据。Storage 全局上限须至少为 50MiB，Fastify 的 `SITE_IMAGE_MAX_BYTES` 默认相同，Nginx 的 52m 额外容纳 multipart 请求头，不代表单张图片可以上传 52MiB。

回滚：将 `current` 指回已保留且兼容当前数据库的旧 release，重启 API。代码回滚不能撤销破坏性数据库迁移。

- API 失败：`systemctl status samstownweb-api --no-pager`、`journalctl -u samstownweb-api -n 80 --no-pager`。
- 登录／后台失败：先检查 `/health`、当前服务工作目录、生产变量及数据库 RLS；不要打印密钥。
- 页面旧版：检查 Nginx root、`current`、浏览器缓存；`VITE_*` 改后重新构建。
- 上传失败：核对 Nginx 52m 请求限制、Fastify 与 Storage 50MiB 文件限制、图片解码限制和 Storage policy。
- 地图提交或密码重置结果不明：先重新读取当前状态并检查 API 日志，不手工删除切片或恢复旧会话；未知提交结果会保留文件，避免破坏已经成功的操作。
- 清理旧 release 前先核对其绝对路径、回滚用途以及各 release 的 node_modules 真实指向。即使旧源码已经上 GitHub，只要当前版或回退版仍引用其中的依赖目录，就不能删除；先在独立环境整理依赖产物。产物目录不是 Git worktree，不要清空 releases 根目录。

## 备份

数据库备份与 Storage 文件必须分别覆盖，并验证可恢复性。可用独立工具 `scripts/backup-current.mjs`：配置见 `.env.example` 的 `BACKUP_*` 与 `PG_*`，需要 PG17+ 客户端、Supabase CLI、独立验证库、专用目录及独立加密密钥。产物包不携带 CLI 登录状态；在服务器单独登录并从 release 目录核对项目、执行 `supabase link --project-ref YOUR_PROJECT_REF`，仅使用具有必要备份权限的凭据。

```bash
cd /opt/samstownweb/current
node --env-file=/etc/samstownweb-backup.env scripts/backup-current.mjs
```

工具验证隔离库恢复及 Storage 文件校验，不等于生产恢复演练；不要丢失加密密钥。`reset-business-storage.mjs` 仅适用于删除 QQ、论坛等旧表前的特定历史维护窗口，当前表结构不适用，不能用于日常更新；`retire-storage.mjs` 是它使用的盘点辅助模块，不是独立删除命令。保留其严格目录检查，不为兼容新表结构放宽清空条件。
