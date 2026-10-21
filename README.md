# 楹雾镇 · SamsTownWeb

Minecraft 社区展示网站：小镇介绍、成员档案、历史、建筑项目地图与博客文章告知。

[网站](https://yingwutown.top) · [SamsBlog](https://blog.yingwutown.top) · [源码](https://github.com/afterSuperSam/SamsTownWeb)

## 架构

首次打开首页显示小尺寸 Yingwu Town 手写签名，整段沿同一条非线性曲线持续加速，1.6 秒写完，不逐笔停顿；内容未就绪时保留完整笔迹，就绪后整段签名轻微放大至 1.06 倍再淡出，不拆分字母，退出共 640ms。签名与页脚共用 SVG 遮罩及笔顺动画，页脚节奏保持不变；支持深浅主题、后台暂停和减少动效，其他页面切换不重复播放。动画参数位于 `visualConfig.loadingSignature`，尺寸与颜色位于 `global.css`。

React + TypeScript + Vite，Fastify 提供认证与管理 API，Supabase 提供 Auth、PostgreSQL、Storage 和 Realtime。生产由 Nginx 同域托管前端与 API。

游客可公开浏览；成员管理自己的地图项目；管理维护全部项目、地图和内容后台。账号仅由后台创建，不开放注册或 QQ 验证。地图不再提供标记、项目状态及筛选搜索，侧栏直接展示项目，支持分页与定位。

后台成员支持按游戏 ID 与分类组合筛选，筛选时暂停排序，保存保留完整成员集合。文案编辑直接使用当前译文目录，废弃文案从目录删除，旧覆盖键在读取时过滤，不维护额外黑名单；个人资料只修改用户名与密码，不提供内部邮箱编辑。地图后台刷新保留现有画布与项目列表，切换身份、地图或页码时隔离列表，底图版本变化时重建画布。

页面与首屏加载共用暖棕纸纹背景，深浅模式分别配置颗粒、纤维强度；首页、档案与地图 Hero 共用 `--hero-mask` 柔边椭圆遮罩，其余图片与视频背景沿水平线柔化。首页和档案共用章节导航，浅色模式使用亮金色光晕；天数区采用 76–128px Georgia 粗体衬线数字，无额外装饰，字体与颜色由 `--counter-font`、`--counter-ink` 管理，页脚版本号保留 SamsBlog 的系统手写字体。首页照片墙在刷新时随机排列，同一次访问内保持稳定；页脚复用 SuperSam 笔迹，浅色悬浮为亮金光晕，底部保持紧凑并避让手机目录按钮。视觉参数集中在 `src/domain/visualConfig.ts`，主题变量在 `src/styles/global.css`。

顶部操作仅保留无底框图标。主题与语言按钮共用颜色、悬停发光、缩放及焦点样式，不单独覆盖主题按钮颜色。点击主题图标时，新主题从点击位置以柔边圆形扩散；键盘操作、减少动效或不支持视图过渡的浏览器直接切换。时长和柔边宽度由 `visualConfig.themeRipple` 配置。

首页 Hero 背景保持静止，文案与按钮整体居中，`YINGWU TOWN` 使用常规字体，中文标题以 72–144px 响应式字号保留逐字渐入；椭圆遮罩从两侧向中央柔和融入背景，页脚版本号为 16px。个人资料入口移至页脚，与楹雾私域按此顺序并排显示纯文字链接，顶部不显示人物头像。

操作按钮统一使用无框、无底色的文字或图标，交互规则集中在 `src/styles/global.css`，页面仅负责排版；输入框、下拉选项和颜色色块保留必要反馈。短页面页脚贴底，长页面自然下移；404 与异常恢复页共用简洁排版，提供返回首页入口。

纸纹覆盖全站背景，包括后台、账号和错误页。媒体管理将已退役页面的旧分类读取为“其他”，保留原文件；只有主动保存时才写回分类。

光晕颜色由 `global.css` 的 `--glow-color` 独立管理：浅色使用亮金色，文字强调色及立体投影保持深色，不混用。

首页 SamsBlog 区域只展示最新一篇文章，不显示区块标题和同步说明。成员名单入口居中；加入区加宽上下柔化带，QQ 入口仅保留镇群 QQ，KOOK 入口不变。操作入口保持无外框：悬停、聚焦和选中平滑变金色，按下轻缩、松开回弹；下划线统一为 2px。强调色共用 `--link-accent`，头图上使用 `--on-media-accent`；禁用控件不响应，危险操作保留警示色，减少动效设置下关闭过渡。

## 本地运行

需要 Node.js `>=22.22.0`、`pnpm@11.9.0`。

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
# 填写 .env，再启动；已有 .env 不要覆盖。
pnpm dev
```

前端 `http://localhost:5173`，API `http://localhost:8787`。只预览公共界面可运行 `pnpm dev:web`；未配置 Supabase 时业务列表为空。Fastify 同步 SamsBlog 文章，默认缓存 5 分钟，首页按 `visualConfig.homeBlogPostLimit` 展示最新一篇；可选 `BLOG_*` 配置见 `.env.example`、`server/config.ts`。

## 验证

```bash
pnpm check
pnpm lint
pnpm test
pnpm test:e2e
```

常规修改只运行相关测试。发布前运行 `pnpm release:check`，依次执行类型检查、lint、测试、构建、依赖审计和浏览器冒烟。GitHub Actions 负责验证，不自动部署。

## 部署与安全

- Ubuntu / Nginx / systemd；环境文件放 `/etc/samstownweb.env`，运行版本由 `/opt/samstownweb/current` 指向，服务名 `samstownweb-api`。
- 2GB 新服务器采用本机构建 `dist/`、`dist-server/`，服务器保留同一提交的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，执行 `pnpm install --prod --frozen-lockfile`。不要删除开发依赖声明或重新生成生产锁文件，也不要在生产机跑完整检查。
- `VITE_*` 会进入浏览器包；Service Role Key 只能用于 Fastify。授权由服务端和数据库 RLS 执行。
- 账号管理只经 Fastify；完成首次改密后才能通过受控 RPC 改名。改密成功后自动更新会话，当前单 API 进程串行处理改密、重置和删号，避免覆盖账号门禁。
- 每次发布固定一个提交，在同一 release 中盘点迁移和构建，避免数据库与代码版本错配。
- 数据库迁移按 CLI 顺序管理。仓库含业务清空迁移，正常更新不能直接执行全部迁移。
- v2.2.0 的 `20261020041649_simplify_roles_and_map_projects.sql` 会归并旧角色、删除地图标记与项目状态；部署前按 DEPLOY 备份并核对迁移历史，与前后端同步切换，不能只更新静态页面。
- `.env`、上传内容、备份、构建产物和依赖不提交到 Git。版本以 `package.json` 为准，页脚自动读取。

## 文档

- [DEPLOY](docs/DEPLOY.md)：环境、首次部署、更新、回滚、备份。
- [INSTRUCTION](docs/INSTRUCTION.md)：使用功能与后台操作。
- [ARCHITECTURE](docs/ARCHITECTURE.md)：代码与数据架构、权限、界面审美。
