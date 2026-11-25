# Changelog

All notable changes to this project are documented here.

## [0.2.0] - 2026-11-25

### Added
- 零交互登录：只读解析 Chromium 系浏览器 localStorage（LevelDB SSTable/WAL + Snappy，零依赖），
  支持 Chrome / Edge / Brave / Chromium / Arc / Vivaldi / Ego Lite
- 自建 OAuth 2.0 授权码 + PKCE(S256) 回环服务作为兜底（state、一次性 60s code、Host 校验）
- `--version` / `-v`
- `npm run check` 自检（语法、未使用 import、硬编码凭证、输出层规范）
- 结构化参数解析 `src/args.js` 与输出层 `src/output.js`
- MIT LICENSE 与合规免责声明

### Changed
- 项目与命令名由 `xiutu` 改为 `pwish`；配置目录/环境变量前缀同步改为 `PWISH_*`
- 文档与实际能力对齐：明确 5 个套图场景、stable 未实测、详情图/视频未实现等边界

### Fixed
- 短选项 `-m` / `-i` 等归一化到长名（此前会静默丢失）
- OSS V1 签名纳入 `x-oss-date` 与 `x-oss-security-token`（此前 403）
- 套图结果按 `data.items.<scene>` 解析（此前落到 `unknown`）
- `login` 解析出的用户 ID 从 token 第二段提取（此前误用接口返回的占位值）

## [0.1.0] - 2026-11-25

### Added
- 初始版本：一句话出图、电商套图、任务查询、历史、下载、队列、额度查询
- agent skill `skill/pwish/SKILL.md`
