# 接口与架构

## 数据入口

页面负责交互和布局；数据读写集中在 `services/` 和各功能的 repository。保留 Fastify + Supabase 双入口，不增加转发每个数据库操作的 API 层。

| 模块 | 入口 | 职责 |
| --- | --- | --- |
| 会话和本人资料 | `services/authService.ts` | 登录、退出、改密、本人资料 |
| 账号管理 | `services/adminApi.ts` | Owner 账号增删改查 |
| 站点内容 | `services/siteRepository.ts` | 内容、成员、历史、FAQ、公告、媒体 |
| 论坛 | `features/forum/forumRepository.ts` | 发帖、编辑、删除、分页 |
| 地图查询和认领 | `features/atlas/data/mapRepository.ts` | 空间 RPC、列表、完整详情、认领和标记 |
| 地图文件管理 | `features/atlas/data/mapApi.ts` | 上传、替换、元数据修改和删除 |
| 统计与操作记录 | `services/webDataRepository.ts` | 统计读取、访问记录、操作日志 |

`apiClient.ts` 统一请求头、会话、取消、超时和错误码。公开请求、可选会话请求、必须登录的请求共用一个实现。JSON 自动设置 Content-Type；FormData 由浏览器生成 boundary。

## HTTP 契约

- JSON 使用 camelCase；数据库 snake_case 在 repository 内转换。
- 成功直接返回业务对象或数组；简单命令返回 `{ ok: true }`；统计写入返回 `204`。
- 创建返回 `201`，读取和更新返回 `200`。
- 错误返回 `{ code: "error.*", details?: unknown }`。参数错误的 details 只包含字段路径和校验类别，不包含输入值。
- `400` 参数错误，`401` 会话无效，`403` 权限或改密门禁，`404` 资源缺失，`409` 状态冲突，`413` 上传超限，`429` 限流；未知异常返回 `500 / error.generic`。
- 权限读取数据库当前 Profile，不相信浏览器提交的角色。

| 方法 / 路径 | 权限 | 请求 | 返回 |
| --- | --- | --- | --- |
| `GET /health` | 公开 | 无 | `{ ok: true, service: "yingwu-api" }` |
| `POST /api/auth/sign-in` | 公开、限流 | `{ username, password }` | `{ accessToken, refreshToken }` |
| `POST /api/auth/change-password` | 认证、限流；允许临时密码会话 | `{ password, confirmation }` | `{ ok: true }` |
| `GET /api/accounts` | Owner | 无 | `Account[]` |
| `POST /api/accounts` | Owner | `{ username, password, role }` | `Account`，role 仅 viewer/member/admin |
| `PATCH /api/accounts/:id` | Owner | `{ role?, temporaryPassword? }`，至少一项 | `{ ok: true }` |
| `DELETE /api/accounts/:id` | Owner | UUID 路径参数 | `{ ok: true }`，Auth 删除失败进入队列 |
| `POST /api/analytics/view` | 公开、限流 | 无；可带 Bearer token | `204` |
| `POST /api/bilibili/resolve` | Owner、限流 | `{ input }` | `{ bvid, title, thumbnailUrl, author, durationSeconds, watchUrl }` |
| `POST /api/maps` | Admin+、限流 | multipart：file、name、description、shortLabel、visible、sortOrder | `TownMap`，`201` |
| `PATCH /api/maps/:id` | Admin+ | `{ name, description?, shortLabel?, visible?, sortOrder? }` | `TownMap` |
| `PUT /api/maps/:id/image` | Admin+、限流 | multipart：file、clearExisting | `TownMap` |
| `DELETE /api/maps/:id` | Admin+ | `{ confirmName }` | `{ ok: true }` |

`Account = { id, username, role, mustChangePassword, createdAt }`，不含 QQ 字段。`TownMap` 字段定义在 `mapTypes.ts`，包含地图 ID、名称、描述、尺寸、切片 revision／prefix、可见性、排序和时间。

旧 `/api/auth/register`、`/api/auth/qq/*`、`/api/profile/qq*` 全部退役，返回 `404 / error.notFound`。前端没有注册模式或绑定入口。

## 权限

| 能力 | 匿名 | Viewer | Member | Admin | Owner |
| --- | --- | --- | --- | --- | --- |
| 公开站点和可见地图 | 是 | 是 | 是 | 是 | 是 |
| 查看论坛 | 否 | 是 | 是 | 是 | 是 |
| 发帖、编辑本人帖子；管理本人认领 | 否 | 否 | 是 | 是 | 是 |
| 管理地图、所有认领和标记 | 否 | 否 | 否 | 是 | 是 |
| 内容、账号与统计后台 | 否 | 否 | 否 | 否 | 是 |

临时密码账号仅允许登录和修改密码。新账号由 Owner 经 Service Role 创建，触发器检查不可由用户编辑的 `app_metadata.yingwu_trusted_provisioning`，拒绝绕过后台公开注册。前端 `can()` 管显示，Fastify 守卫管 HTTP，数据库 RLS / RPC 管真实数据权限。

## Supabase 契约

普通结构化表查询使用 `database.types.ts`；JSON RPC 在 repository 的唯一入口校验，不再另写字段缺失的兼容分支。

| RPC | 输入 / 返回职责 |
| --- | --- |
| `resolve_profile_id` | 服务端按规范化用户名解析账号 ID |
| `update_own_username` | 当前账号修改用户名 |
| `replace_town_members`、`replace_town_history`、`replace_town_announcements`、`replace_faq_items` | Owner 原子替换对应有序集合 |
| `list_forum_posts` | kind、limit、offset、authorId；返回帖子分页 |
| `get_map_occupancy` | mapId、blockSize；返回有界占用概览 |
| `get_map_viewport` | mapId、ChunkBounds、area、offset、limit；返回精确格子或标记页、总数和 revision |
| `list_map_claim_summaries` | 全图筛选和分页；返回数量、定位边界和筛选选项 |
| `get_map_claim_detail` | mapId、claimId；返回完整认领格，编辑前使用 |
| `save_map_claim` | 项目、归属、颜色、状态、完整 cells；返回 `{ claimId, conflicts }` |
| `queue_town_image_deletion`、`queue_own_storage_cleanup` | 媒体删除及上传失败补偿 |
| `prepare_account_deletion` | Owner 核对账号、转移持有对象并登记 Auth 删除队列 |

精确参数名以 `database.types.ts` 为准。地图分页保留总数、revision 和完整详情校验，避免把部分数据当空闲区域或在保存时误删未加载格子；权限切换后清除私有缓存。

## 共享界面模块

| 模块 | 统一行为 |
| --- | --- |
| `Button.tsx` | Button / IconButton / SaveButton：默认类型、图标、忙碌状态、保存文案 |
| `Dialog.tsx` | 原生 dialog：顶层显示、焦点、Escape、遮罩关闭；DialogActions 和 ConfirmDialog 共用按钮 |
| `SelectField.tsx` | 原生 select：键盘、移动端选择和统一样式 |
| `RetryNotice.tsx` | Notice / RetryNotice：错误／成功语义、错误翻译和重试 |
| `OrderedCollection.tsx` | useOrdering / OrderControls：有序集合及媒体共用拖拽、上下移动 |
| `TownImage` / `TownMedia` / `MediaFigure` | 图片来源、视频播放、标题和图注 |
| `TerrainLoading.tsx` | 页面与区域加载状态 |

业务页面保留自身表单状态，展示复用上述模块。视觉变量集中在 CSS `:root`；不得为同一保存、取消、确认或选择行为复制另一套组件。

## 数据与产物

- `profiles` 保留账号资料；QQ 私有表和专属 RPC 由新增迁移删除。
- `site-images` 展示公开媒体；`town-maps` 原图私有，可见地图生成瓦片按 policy 读取。
- Storage / Auth 失败补偿保留：外部删除不能与 PostgreSQL 形成一个事务。
- `dist/` 为前端产物；`dist-server/` 每次 API 构建重建且不包含测试。
- 游戏控制预留表未接入当前产品，仍不向 anon/authenticated 开放；不新增任何游戏命令接口。

数据库领域术语见 [CONTEXT.md](../CONTEXT.md)。迁移顺序和生产未执行项见 [README](../README.md#部署与数据库)。
