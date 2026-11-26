# Changelog

本项目所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.4.1] - 2026-11-26

### Fixed

- 帮助信息里详情图场景名写错（`highlight` → `highlights`），并修正重复的 `-m` 说明

## [0.4.0] - 2026-11-26

### Added

- **`pwish detail` 电商详情图**：商品图 + 卖点 → 详情页模块图，已对线上接口实测（一次任务产出 3 张）
  - 场景：`poster` 海报、`highlights` 亮点合集、`feature` 卖点、`detail` 细节、
    `lifestyle` 场景生活、`scenes` 多场景、`dimensions` 尺寸标注
  - 两段式流程：先用 `tasks/login/suite/prompt`（`from=detail-custom-prompt`）按场景写带排版描述的提示词，
    再用 `tasks/login/suite`（`from=design-detail`）出图，结果按场景命名下载
  - 接入配额预检与跑后额度回读（「详情图」独立额度池）
- 场景推荐接口 `tasks/login/suite/recommend` 打通，用于确认详情图可用场景

### Changed

- README / SKILL.md 增补详情图命令、场景表、额度口径与「先试 2-3 个场景」的用量建议
- 已知限制中移除「详情图未实现」，仅保留视频（账号无视频额度，未实测）

## [0.3.2] - 2026-11-26

### Fixed

- 未登录提示不再提「自动读取已登录浏览器」（该能力已在 0.1.4 移除）

## [0.3.1] - 2026-11-26

### Fixed

- 额度表模型口径与 `pwish models` 对齐：`nano-banana-pro` 同时计入 Nano Banana 2 与 Gemini 3.1 两个额度池
  （多候选字段取最大值，避免有额度却判成 0），并单列「即梦 5.0 Flash」

## [0.3.0] - 2026-11-26

### Added

- 会员 / 算粒 / 额度体系化反馈（`src/quota.js`）：
  - `pwish quota` 重做：账号身份（免费或会员、到期、算粒）+ 生图模型免费次数 +
    设计任务（套图 / 详情图 / AI 图片编辑）+ 图片工具（含「今日已用」计数），中英混排按显示宽度对齐
  - `pwish quota --json` 输出会员、算粒、各模块额度结构，便于脚本消费
  - 生成前预检：`gen` / `suite` / 图片工具在额度为 0 时直接拦下，并列出还有额度的替代模型
  - 任务结束后回读额度，打印 `额度：xxx 免费剩余 N 次`
  - `--force` 跳过预检（账号仍有会员权益但被判为 0 时使用）
- `pwish whoami` 增加会员身份与算粒摘要
- `test/quota.test.js`：额度归类、会员身份、预检拦截的回归测试

### Changed

- 额度相关错误码改为可执行提示：`CREDIT_NOT_ENOUGH`、`DAILY_LIMIT_EXCEEDED`、
  `FREE_PREVIEW_LIMIT_EXCEEDED` 都说明下一步该做什么
- 帮助信息补充 `--force` 与新的 quota / whoami 说明

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
