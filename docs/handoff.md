# 当前交接状态

## 源码与验证

源码 `v2.0.0`：QQ 注册／绑定退役；账号由 Owner 创建；请求、按钮、通知、对话框、选择框和集合排序共用实现。主页 Hero、浅色过渡、滚动条和下划线控件已统一。

2026-10-13 完成当前工作区的代码、依赖、敏感文件、部署文档和视觉巡检。`pnpm check`、`pnpm lint`、`pnpm test`（30 项）、`pnpm build`、`pnpm audit --prod` 和 `pnpm test:e2e` 均通过；当前内容准备推送到 `afterSuperSam/SamsTownWeb` 私有仓库 `main`。

目标 Supabase 项目为 `zqddeeljxwfkguqugucg`（`ap-northeast-1`）；已从旧项目 `hsbshnhtxplqecbhrirt` 导入账号与保留功能的数据，QQ、资源与材料退役保持不变。服务端 Secret 只保存在本机 `.env`。

- check、lint 和六文件 30 项 Vitest 验证通过。
- 新项目通过 MCP 建立结构，已有迁移种子内容；QQ 退役后再应用资源与材料退役，清空迁移 `202610050001` 未执行。远端版本与本地时间戳不同，CLI 迁移历史未对齐。
- 一个浏览器文件的公共导航／登录场景通过；共享按钮、原生对话框和选择框已由统一组件、类型检查与视觉巡检覆盖。

## 生产差异

2026-10-07：已导入 19 个账号／档案、2 张地图、9 条认领、2508 个地图格、6 个标记、15 条历史、135 名成员、34 张保留图片和 462 条审计记录；目标端无 QQ 元数据且认领无孤立 Owner。旧项目未修改；Storage 已核对 `site-images` 9 个、`town-maps` 464 个对象，3 个大 PNG 已补传并完成大小核对。

部署前完成目标 Secret 的服务器配置和登录冒烟测试。历史迁移含 Storage 前置和全量业务清空，不得直接推送全部迁移；生产清空迁移仍未执行。旧项目 QQ 绑定及其他数据保留未改，完整维护步骤集中在 [部署文档](DEPLOY_UBUNTU_24.md)，HTTP 和组件说明集中在 [架构文档](ARCHITECTURE.md)。

## 外部服务

以下为既有部署约定，当前未重新盘点运行状态：

- 网站 API：`yingwu-api` systemd，回环端口 `8787`，由 Nginx 代理。
- 网站目录：`/opt/yingwu`；生产环境文件：`/etc/yingwu/yingwu.env`。
- NapCat / AstrBot：独立 Docker Compose，约定目录 `/opt/yingwu-bot`；机器人状态和 QQ 登录态需要独立备份。网站 QQ 身份验证退役不影响这些服务。
- Minecraft Console Client：独立 `/opt/yingwu-mcc`，不属于网站账号入口；运行时与启动方式需现场核对。
- SamsBlog：独立应用，网站清理不扩展到其数据库或目录。

网站数据库、`site-images`／`town-maps` 以及待通过 Storage API 删除的空 `schematics` bucket、环境密钥和当前 release 的备份方式见部署文档。数据库／Storage 删除不能靠代码回滚恢复。
