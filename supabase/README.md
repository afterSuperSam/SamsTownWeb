# Supabase 初始化与迁移

本目录记录本地数据库 schema、RLS、RPC、Storage policy 和迁移文件。新项目的 MCP 远端 migration 版本与本地时间戳不同，当前不能视为已对齐的远端历史。平台架构见 [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)，生产发布见 [`../docs/DEPLOY_UBUNTU_24.md`](../docs/DEPLOY_UBUNTU_24.md)。

## 新项目初始化

1. 在 Supabase 创建项目。
2. 从官方 [CLI 文档](https://supabase.com/docs/guides/local-development/cli/getting-started) 了解认证方式；本项目通过 pnpm 固定 CLI `2.109.1`。
3. 链接项目并先审查迁移：

```bash
pnpm dlx supabase@2.109.1 link --project-ref zqddeeljxwfkguqugucg
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db push --linked --dry-run
pnpm dlx supabase@2.109.1 db push --linked
pnpm dlx supabase@2.109.1 migration list --linked
pnpm dlx supabase@2.109.1 db lint --linked --level warning
```

以上是历史已核对后的 CLI 流程；当前新项目存在历史版本差异，且未执行清空迁移 `202610050001`，不得直接运行 `db push`。不要把单个 migration 复制到 SQL Editor。正常迁移按文件名顺序应用；已登记迁移不得改名、删除或改写。

当前目标项目为 `zqddeeljxwfkguqugucg`（`ap-northeast-1`），已从旧项目 `hsbshnhtxplqecbhrirt` 导入账号与保留功能数据，保持 QQ、资源与材料退役。目标端已核对 19 个账号／档案、2 张地图、9 条认领、2508 个地图格、34 张保留图片和 462 条审计记录；Storage 已核对 `site-images` 9 个、`town-maps` 464 个对象，未导入 QQ 绑定、资源和材料数据。本轮未修改旧项目。

## 首个 Owner

先关闭 Supabase Email 公开注册，保留 Email/Password 登录。本次先迁移并核对旧账号与 Owner，已有 Owner 不重复创建。以下仅适用于确认没有 Owner 的新部署，首个账号通过可信终端中的 Service Role 创建，不能走公开 signUp：

```js
import { createClient } from "@supabase/supabase-js";
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await client.auth.admin.createUser({
  email: "YOUR_OWNER_EMAIL", password: "YOUR_OWNER_PASSWORD", email_confirm: true,
  app_metadata: { yingwu_trusted_provisioning: true },
  user_metadata: { username: "DogSam" }
});
if (error) throw error;
console.log(data.user.id);
```

此示例仅用于本机或服务器初始化，不进入浏览器或 Git。复制返回的 Auth UUID，在 SQL Editor 执行一次角色初始化：

```sql
update public.profiles
set username = 'DogSam', role = 'owner', must_change_password = false
where id = 'AUTH_USER_UUID';
```

后续账号只由 Owner 后台创建。QQ 注册和绑定已退役。已有 Owner 不重复初始化。

## 环境变量

本地复制仓库根目录 `.env.example` 为 `.env`，不是 `.env.local`：

```powershell
Copy-Item .env.example .env
```

- 前端只使用 `VITE_SUPABASE_URL` 和 Anon/Publishable Key。
- Service Role Key 只放 Fastify 环境，绝不加 `VITE_` 前缀。
- Supabase Personal Access Token 只供 CLI 临时认证，不是 Anon Key，也不写入仓库。

## 数据访问边界

- 暴露 schema 中的业务表启用 RLS。
- Data API `GRANT/REVOKE` 决定角色能否访问表，RLS 决定能访问哪些行。
- 角色授权不读取用户可编辑的 `user_metadata`。
- `SECURITY DEFINER` 函数固定空 `search_path`、执行调用者检查，并显式撤销不需要的 `PUBLIC/anon/authenticated` 执行权限。
- Storage upsert 同时需要符合业务模型的 INSERT、SELECT 和 UPDATE policy。
- 预留 Folia 表已撤销 `anon` 与 `authenticated` 权限，当前不属于公开 Data API。

## Storage

- `site-images`：站点媒体。
- `town-maps`：私有 bucket；可见地图的生成 Deep Zoom 瓦片允许 `anon/authenticated` 按 policy 读取，原图仍私有，写入由 Fastify Service Role 完成。

Storage 与 Auth 删除失败会进入补偿队列。不要绕过队列直接破坏数据库和外部对象的一致性。

资源与材料的退役迁移会删除专属表、RPC、类型和策略，并检查存活函数无旧表引用。Storage 的 `schematics` bucket 由触发器保护，SQL 只验证它为空；实际 bucket 删除必须通过 Storage API 完成，禁止直接删除 `storage.objects` 或 `storage.buckets`。新项目没有旧对象，因此可先完成数据库退役，再按部署文档清理空 bucket。历史迁移保留，不能以删旧 SQL 文件代替数据库清理。

地图空间查询分为全图占用概览、有界精确视口、独立分页摘要与按 ID 完整详情；地图访问权限在每个 RPC 验证。Claim 与认领格通过复合外键绑定同一地图，迁移前检测历史错配，发现异常停止。

## 新增迁移

`202610050001_reset_business_data_keep_accounts.sql` 是生产数据清空流程，本次新项目未执行；旧数据迁移需要保留账号与保留功能的数据，不应套用该清空流程。新项目通过 MCP 建立结构并应用地图完整性、QQ 退役和资源与材料退役；因先前执行错误，资源退役在 QQ 退役之后应用。远端 migration 版本与本地时间戳不同，CLI 历史未对齐，不能据此直接继续 `db push`。

隔离 PostgreSQL 已验证按序迁移、非可信注册拒绝和地图 RLS；跨项目数据已导入并完成表计数与外键核对。迁移使用新的目标 Auth 用户并保留源密码哈希；QQ 元数据已清除，旧项目未修改。Storage 大文件已补传并完成大小核对，部署前仍需配置目标 Secret 并做登录冒烟测试。

先查看当前 CLI 帮助，再创建迁移：

```bash
pnpm dlx supabase@2.109.1 migration new descriptive_name
```

完成 schema/RPC 变化后：

1. 检查 RLS、GRANT/REVOKE、函数 EXECUTE、Storage policy、索引和外键。
2. 本地可用 Docker 时运行本地数据库验证；不可用时明确记录未完成的验证。
3. 对 linked 项目运行 `migration list`、`db push --dry-run` 和 `db lint`。
4. 重新生成并提交 `src/lib/database.types.ts`。
5. 更新 README、`docs/ARCHITECTURE.md`、相关测试和部署说明。

`supabase/.temp` 保存本机 linked 状态并不提交。生产 linked 命令必须从 `/opt/yingwu/source` 执行，不能从独立 release worktree 执行。
