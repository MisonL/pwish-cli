# Changelog

本项目所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.2.1] - 2026-11-26

### Fixed

- `pwish skill --install --dir` 现在把 `--dir` 当作技能根目录，自动创建 `pwish/` 子目录
  （此前会直接把 SKILL.md 放到根目录下，与本机默认路径结构不一致）
- 工具缺少必填参数的用例改用临时文件，CI 不再依赖本地 `/tmp` 残留

## [0.2.0] - 2026-11-26

### Added

- 8 个图片工具命令，均已对线上接口实测跑通（上传 → 建任务 → 轮询 → 下载全链路）：
  - `pwish cutout` 抠图去背景，输出透明底 PNG
  - `pwish upscale` 变清晰 / 放大，支持 `--type photo|general|text` 与 `--scale`
  - `pwish restore` 高清修复（模糊、低清、老照片）
  - `pwish bg` AI 换背景：内部先抠透明底再生成场景，一次返回多张候选
  - `pwish dewatermark` 自动去水印
  - `pwish erase` 去杂物 / 擦除，需 `--mask` 蒙版与可选 `--strength`
  - `pwish colorize` 黑白照片上色
  - `pwish convert` 图片格式转换（jpg / png / webp / bmp / gif）
- `resultUrls` 统一结果解析：忽略预览图、蒙版与加速地址，自动兼容单图、多候选与 `answer` 结构
- `test/tools.test.js`：工具结果解析与格式校验回归测试；args 测试补充工具参数与缺参提示

### Changed

- 帮助信息与 README / SKILL.md 增补图片工具章节、接口表与组合用法

## [0.1.5] - 2026-11-26

### Fixed

- 端口被占用时给出可读提示与换端口建议（此前只抛 EADDRINUSE）
- 登录页 `/api/*` 异常统一返回 JSON，上游故障时页面能显示真实原因
- 清理无用命令行开关与未使用的导出

### Added

- 端口冲突与 API 错误格式的回归测试（共 44 个）

## [0.1.4] - 2026-11-25

### Changed

- 移除旧的「从已登录浏览器读取 localStorage」路径及其解析器；登录统一走本机登录页，
  包体更小，行为与文档一致

## [0.1.3] - 2026-11-25

### Fixed

- `npm test` 改用 `node --test` 自动发现测试，兼容 Node 20 与 CI（CI 现已全绿）

## [0.1.2] - 2026-11-25

- 修复 0.1.1 发布中断导致的包不可安装问题（重新发布同内容）

## [0.1.1] - 2026-11-25

### Added

- `pwish skill` 命令：从 npm 包一键安装 agent skill 到 `~/.agents/skills/pwish`，
  支持 `--install --dir`、`--showpath`、`--print`
- README 增加登录页截图与从 npm 安装、skill 安装的完整引导

### Fixed

- Host 头校验正则转义，避免形如 `127x0x0x1` 的伪造主机绕过
- 参数解析器登记 skill 命令相关 flag

## [0.1.0] - 2026-11-25

首个公开版本。

### Added

- **本机登录页**：`pwish login` 在 `127.0.0.1` 起临时授权服务并打开自建登录页，
  支持微信扫码与手机号/邮箱 + 密码两种方式，视觉对齐佐糖官网登录页；
  登录凭据经本机服务调用官方账号接口换取登录态，密码不落盘
- OAuth 2.0 授权码 + PKCE(S256) 回环流程（state 防 CSRF、授权码一次性 60 秒、Host 校验防 DNS rebinding）
- 一句话出图 `pwish gen`：参考图上传、模型/比例/清晰度/张数/经济与稳定模式
- 电商套图 `pwish suite`：AI 按场景写提示词后批量出图（白底主图、核心卖点、卖点、材质、模特）
- 结果管理：`task`、`history`、`show`、`download`、`queue`、`quota`、`models`
- agent skill `skill/pwish/SKILL.md`
- 跨平台支持：macOS / Linux / Windows 的浏览器授权链接打开与剪贴板读取
- 工程化：静态自检、格式检查、CI（Node 20 / 22）、44+ 单元测试

### 说明

- 套图支持 5 个场景；「场景展示图」「多场景拼图」暂不支持
- 电商详情图、电商视频暂不支持
- `--mode stable` 参数可下发，出图效果与计费差异未经实测
- 免费额度生成的图片带水印，去水印需按站点规则升级
