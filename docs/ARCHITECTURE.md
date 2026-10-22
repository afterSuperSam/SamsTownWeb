# 架构与审美

## 代码边界

```text
浏览器 ── Nginx ── React 静态文件
               └─ /api、/health ── Fastify ── Supabase Auth / Storage
React repository ── Supabase Data API / RPC / Realtime（RLS）
```

| 目录 | 职责 |
| --- | --- |
| `src/pages` | 首页、档案、地图、账号、后台的组合与交互 |
| `src/components` | 按钮、对话框、通知、加载、媒体、成员与装饰 |
| `src/features` | 地图和后台功能域；`data` 管数据，`domain` 管纯逻辑 |
| `src/services` | 登录、账号管理、站点资料、统计与统一 HTTP 请求 |
| `src/state`、`i18n`、`theme` | 会话、语言与深浅主题 Context |
| `src/styles` | 设计变量、组件样式、照片墙样式 |
| `server` | Fastify 入口、鉴权、HTTP 路由、上传与清理队列 |
| `supabase/migrations` | 按时间顺序保存的 schema、RLS、RPC 和 Storage policy |
| `scripts`、`tests`、`e2e` | 独立运维工具与现有验证 |
| `images/optimized`、`public` | 随构建发布的优化图片、图标与视频 |

状态使用 Context 与页面自身状态，不引入额外状态框架。页面不直接拼数据库查询；表字段映射集中于 repository，JSON RPC 在数据边界校验。

## 核心数据

- `profiles`：用户名、角色与首次改密状态；账号由 Supabase Auth 保存。
- `site_content`：双语文案覆盖与公开联系方式。
- `town_members`、`town_history`、`town_images`、`faq_items`：社区内容。
- 博客文章不存入 Supabase；Fastify 从 SamsBlog 的公开 JSON 接口读取，校验、去重、按发布时间降序取 3 条并缓存。
- `town_maps`、`map_claims`、`map_claim_cells`：地图、项目及其区块范围；保留已有数据表名，不另建重复模型。
- `site-images` 为公开媒体；私有 `town-maps` 保存原图与切片，可见地图的切片由 policy 放行。

地图术语：Pixel 对应一个游戏方块；Chunk 是 `16×16` Pixel；Project 是一个项目及其区块集合；Region 是其中四向相邻的一片。建造者是单人展示资料，ownerId 是拥有编辑权的站内账号。项目没有状态或单独可见性，标记功能已移除。

全图项目区块按序分页读取，全部就绪后展示；侧栏独立分页，详情与编辑通过 `get_map_claim_detail` 读取完整项目。底图使用 OpenSeadragon 瓦片缩放，关闭平滑插值；目录刷新与同用户重复认证不重建画布，同一列表的后台重验保留旧内容。未使用区块不存记录。

## 数据入口与权限

| 入口 | 功能 |
| --- | --- |
| `authService` / `/api/auth/*` | 用户名登录、会话、改密与本人资料 |
| `adminApi` / `/api/accounts*` | 管理创建和维护账号 |
| `siteRepository` | 社区内容及媒体，管理原子保存有序集合 |
| `getBlogPosts` / `/api/blog/posts` | 独立加载博客文章，跨站请求由 Fastify 转发 |
| `mapRepository` / `mapApi` | 地图读取、项目 RPC、`/api/maps*` 上传与管理 |
| `webDataRepository` | 访问统计和操作日志 |

HTTP JSON 使用 camelCase；数据库 snake_case 在 repository 转换。错误返回 `{ code: "error.*", details? }`；未知错误只在内部记录，浏览器通过翻译表显示产品提示。`GET /health` 返回 `{ ok: true, service: "yingwu-api" }`。

前端 `can()` 控制展示，Fastify 校验 token 与当前 Profile，数据库 RLS／RPC 执行最终授权。角色取自可信资料，不接受客户端提交的权限。临时密码门禁、限流、上传校验、异步竞态隔离和外部删除补偿都是业务完整性的一部分。

游客为无会话状态；应用角色仅 `member`（成员）与 `owner`（管理）。成员可管理自己的项目；管理可管理全部项目和后台。旧 viewer/admin 账号在迁移中归并为 member，PostgreSQL 历史 enum 值保留，但 Profile CHECK 禁止再次写入。公开注册保持关闭。

浏览器只读 `profiles`，改名通过受控 RPC 且必须完成首次改密，账号管理统一经过 Fastify。新账号的内部 Auth 邮箱使用独立随机标识；改密后重新签发会话。当前单进程内串行处理改密、重置与删号准备，排队后重新鉴权；这不替代多实例部署所需的数据库并发控制。

数据库类型由 `src/lib/database.types.ts` 提供。修改 schema 后按 [DEPLOY](DEPLOY.md) 的迁移流程更新类型；旧迁移不改写、不删除。未接入的游戏控制表不向浏览器开放。

## 审美

暖棕、典雅、克制的 Minecraft 社区档案感。照片与内容为主体，琥珀色用于引导，不使用霓虹或第二套组件风格。

| 变量 | 深色 | 浅色 |
| --- | --- | --- |
| `--bg` | `#211c18` | `#eee2cb` |
| `--surface` | `#2a241f` | `#f7edd9` |
| `--text` | `#f0e4d1` | `#3a2a1d` |
| `--amber` | `#d38d42` | `#8a4d20` |

变量统一在 `styles/global.css` 的 `:root`。正文使用 Noto Sans SC／系统字体，一级标题使用 Playfair Display，天数通过 `--counter-font` 使用 Georgia 粗体，页脚版本号通过 `--font-handwriting` 使用 SamsBlog 的 Segoe Print／楷体／微软雅黑字体栈；中文不使用像素字体。文字继承主题阴影，浅色使用深棕投影而非白色高光，媒体标题保留专用阴影；导航和签名光晕使用独立亮色变量。大圆角、柔和阴影和留白形成层级。

- **按钮**：复用 `Button`／`IconButton`／`SaveButton`，无装饰外框；用底色、聚光、微缩放、按压和键盘焦点表达状态。危险操作保留危险色与确认。
- **表单**：输入、复选框和文件按钮共用主题样式；`SelectField` 用顶层弹出菜单统一选项外观，支持搜索、方向键、Escape 与焦点恢复；`Dialog` 统一模态隔离及动作区。
- **图片**：`TownImage`／`TownMedia`／`MediaFigure` 共用加载和说明，悬浮或聚焦时出现备注；照片墙保留适合其流动布局的交互。
- **背景媒体**：首页、档案与地图 Hero 共用 `global.css` 的 `--hero-mask` 椭圆渐变，无额外 SVG 曲线。Join、成员视频等普通背景使用 `--media-mask-top/bottom` 水平渐隐。蒙版放在稳定外壳而非缩放图片上，透明边缘直接露出主题背景；`HeroTransition` 只提供留白，不叠色带。
- **背景**：纸纹伪元素位于 `body`，覆盖公开页、后台、账号与错误页；首屏加载复用同一组样式，普通页面不重复叠层。装饰位于内容后方，不覆盖照片或地图；`--paper-*` 管强度和周期。不再使用 DiamondGlows。
- **目录与签名**：`SectionNavigation` 供首页和档案共用；只强调当前或聚焦项，其他竖线按距离递减，带阴影的无框提示文字整句从右向左轻弹。`FooterSignature` 使用 SVG 遮罩和原生动画，离开重进重播，后台标签页暂停，卸载取消。参数集中在 `domain/visualConfig.ts` 并经 schema 校验。
- **动效**：`--ease-out: cubic-bezier(.22,1,.36,1)`；优先 transform／opacity。复用 `useScrollReveal`，不为同一元素重复建立观察器。局部聚光直接写 CSS 变量，不触发 React 重渲染。
- **首页头图**：背景静止，不缩放或漂移；标题、简介和按钮整体居中。英文眉题以常规字体显示为 `YINGWU TOWN`，主标题在 72–144px 间缩放。保留逐字渐入，不使用弹跳；底部为左右对称的柔边椭圆。页脚版本号为 16px，右侧依次为个人资料和私域纯文字入口，手机端独立成行。
- **主题切换**：`ThemeContext` 用原生 View Transition 快照和圆形软边蒙版从点击处揭开新主题；参数由 `visualConfig.themeRipple` 校验。切换期间暂停颜色过渡，完成后清理临时样式；键盘、减少动效和不支持的浏览器直接切换。顶部按钮无底框，仍保留可访问名称和键盘焦点。
- **加载**：地形动画仅在当前文档首次进入首页出现；页面切换淡入，外部博客文章独立加载，不阻塞首屏。
- **无障碍与小屏**：保留键盘焦点、ARIA 和触控操作；适配 `prefers-reduced-motion`、深浅主题与 320px 宽度，不出现页面横向溢出。
