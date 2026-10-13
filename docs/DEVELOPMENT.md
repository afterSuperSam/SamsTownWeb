# 开发与验证

## 本地启动

使用 `package.json` 指定的 Node / pnpm。Windows、Linux 和 macOS 的应用命令相同：

```bash
pnpm install --frozen-lockfile
# 将 .env.example 复制为 .env，并填写本机配置。
pnpm dev
```

仅启动前端用 `pnpm dev:web`，仅启动 API 用 `pnpm api:dev`。`.env` 供 Fastify 读取；Vite 只暴露 `VITE_*`。配置说明集中在 [README](../README.md#使用与配置)，生产密钥放服务器环境文件。

## 普通改动

```bash
pnpm check
pnpm lint
# 只运行改动涉及的测试文件；全部精简测试用 pnpm test。
pnpm exec vitest run server/app.test.ts
```

不执行覆盖率检查、不补历史版本契约、不重复跑无关测试。共享控件变化时运行现有浏览器场景 `pnpm test:e2e`。测试通过后，只有新增改动或未解决风险才追加验证。

## 发布

```bash
pnpm release:check
```

执行 check → lint → test → build → audit → e2e。普通 CI 只运行 check、lint、精简测试；手动 workflow 的 `release` 开关执行完整发布验证，不自动部署。

## 最小测试分布

| 文件 | 验证行为 |
| --- | --- |
| `server/app.test.ts` | 会话、权限、临时密码、错误、限流和第三方地址边界 |
| `server/maps/mapStorage.test.ts` | 解码上限、伪装文件和上传失败补偿 |
| `src/domain/permissions.test.ts` | 权限矩阵、危险链接和 Chunk 选择 |
| `src/services/apiClient.test.ts` | 会话、JSON / FormData、错误、超时和媒体补偿 |
| `src/features/atlas/data/mapRepository.test.ts` | 空间分页、版本变化、完整详情和地图归属 |
| `tests/backup-current.test.ts` | 备份路径、恢复前置和重置默认只读 |
| `e2e/public-navigation.spec.ts` | 公共页面／登录入口，共享原生控件 |

六个 Vitest 文件共 30 项，一个浏览器文件保留一个公共导航场景。新测试优先加入已有模块文件，只验证用户行为或真实风险。

## 数据库变更

新建追加迁移，不修改已登记迁移；Supabase CLI 按顺序应用。先查看 `migration list --linked` 和 `db push --linked --dry-run`。当前存在旧业务清空迁移，生产推进条件见 [部署文档](DEPLOY_UBUNTU_24.md)。

本机 PostgreSQL 可运行单个隔离夹具：

```powershell
$env:PG_BIN_DIRECTORY = 'C:/Program Files/PostgreSQL/16/bin'
node tests/retirement-database-integration.mjs
```

脚本仅启动自建回环数据库，按序重放全部迁移，验证 QQ 清理／账号保留和地图权限；结束后停止数据库。它不读取 `.env` 或生产数据库，也不代替真实 Supabase Auth / Storage 验证。夹具文件为 `database-bootstrap.sql` 与 `map-database-integration.sql`，不维护多份历史退役场景。

应用远端迁移后重新生成 `src/lib/database.types.ts`。本次类型已与本地迁移同步；远端未应用状态见交接文档。

## 实现与文档

- 页面组合模块，repository 管数据；接口参数和错误语义见 [架构文档](ARCHITECTURE.md)。
- 合并重复按钮、通知、对话框、排序与请求逻辑，避免只转发参数的包装层。
- 注释写中文职责，日志写英文；用户错误由翻译表输出。
- 页面视觉改动先在桌面和 390px 移动宽度检查首屏、导航、可交互控件、图片画廊和横向溢出，再运行浏览器冒烟测试。
- 功能和配置同步 README，HTTP / RPC 同步架构文档，部署命令同步部署文档。
- commit 使用约定式前缀与中文说明；功能更新增加次版本，修复增加补丁版本。
