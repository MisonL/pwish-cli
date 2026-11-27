# Changelog

本项目所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.11.0] - 2026-11-27

按最新确认的计数行为调整反馈，避免误导：

### Changed

- 跑完回读改成**前后对比**：计数下降才说「本次 消耗 N」，没变化就明确写「站点计数未变化」
  （抠图、格式转换的计数本就不随调用变化，旧文案会让人以为额度没被扣）
- 额度预检拦截时始终提示 `--force` 出口，不再只对会员显示
- `pwish translate --from auto` 在本地直接拦下并提示按实际语种传参，不再白跑一次服务端任务

### Tests

- 新增 `test/quota-delta.test.js`（4 条：消耗/增加/未变化/缺数据），并补 auto 拦截测试（96 → 101）

## [0.10.0] - 2026-11-27

### Added

- `--quiet`（或 `PWISH_QUIET=1`）：只输出结果行，不打印进度，便于脚本调用
- 批量任务遇到额度耗尽（`CREDIT_NOT_ENOUGH` / `DAILY_LIMIT_EXCEEDED` / `FREE_PREVIEW_LIMIT_EXCEEDED`）
  会立即停止并汇总「跳过 N」，不再把剩余图片逐个撞一遍
- GET 请求遇到网络错误自动重试 2 次（400ms/800ms 退避）；POST 绝不重试，避免重复建任务/扣额度
- 补测试：GET/POST 重试差异、`isQuotaExhausted` 判定（94 → 96）

### Changed

- **纠正额度恢复口径**：跨天实测翻译 7→7、扩图 0→0 均未回补，抠图计数从不随调用变化。
  CLI 不再提示「次日重置」，改为「是否回补以站点为准」；README 补实测数据表

## [0.9.1] - 2026-11-26

### Changed

- `pwish quota` 不再显示「今日已用 N」：站点的 `*_used_free_num` 字段对抠图、格式转换连续成功后
  并不变化（翻译、扩图会实时递减），语义无法确认，只保留可信的「剩余」列
- README 增加「额度什么时候恢复」说明：免费用户按天、会员按月；接口不下发重置时间戳，
  前端用本地日期归零，CLI 不把具体时刻写成确定值

## [0.9.0] - 2026-11-26

### Added

- **`pwish batch gen <目录> --prompt "..."`**：批量生图，每张参考图各出一张（`--n` 可多张），
  整批共用一个会话；`--prompt-file` 每行对应一张，单行则复用；条数与图片数不一致直接报错
  - 已实测：1 张图 → 1 张成品（nano-banana-pro）
  - 按「张数 × --n」核对模型额度，超额直接拦下，`--force` 可越过

### Changed

- 抽出 `resolveBatchPrompts`（提示词分配）与 `describeApiError`（错误码翻译）两个纯函数，便于单测
- `loginWithToken` 的格式提示不再提浏览器 localStorage，改为「`pwish login` 拿到的 token」

### Tests

- 94 条（原 78）：新增 `test/api.test.js`（错误码映射 4 条）、`test/upload.test.js`（MIME 与 OSS 签名 4 条）、
  `test/gen-batch.test.js`（提示词分配 4 条）、`test/quota.test.js` 边界 4 条

## [0.8.0] - 2026-11-26

### Added

- **`pwish batch <工具> <目录|文件...>`**：对一个目录里的图片批量跑同一个工具
  - 逐张打印成败，单张失败不影响其它张，最后汇总 `完成 N/M`（有失败时退出码 1）
  - 开跑前核对剩余额度，张数超过剩余次数直接拦下，`--force` 可越过
  - `--concurrency 1-4` 控制并发，默认 1
  - 只挑图片扩展名（jpg/jpeg/png/webp/bmp/gif/heic/avif），显式传入的文件不校验扩展名
- 单图与批量共用同一套执行/下载逻辑（`runToolOnce`），行为与输出保持一致
- 补 4 条 `collectInputs` 测试（测试 74 → 78）

## [0.7.0] - 2026-11-26

### Added

- **`pwish translate` 图片翻译**：把画面文字换成目标语言、保留原有版式，已实测
  （中文截图 → 英文，`images[].image` 取图；两次任务分别消耗 1 次额度）
  - `--from/--to` 用站点语言码（CHS/CHT/ENG/JPN/KOR/FRA/DEU/ESP/POR/PTB/ROM/RUS/VIN/ARA/THA）
  - 接入额度预检与回读（`image_translate_num`）
  - 语言码非法或源/目标语言相同时不发起请求
- 补 2 条翻译参数校验测试（测试 72 → 74）

### Fixed

- 图片翻译的 `source_language` 传 `auto` 会被服务端判为 `task failed`（实测），
  因此默认值定为 `CHS`，并在文档里写明要按图片实际语种传具体语言码

## [0.6.1] - 2026-11-26

审查与清理（无功能变化）：

### Changed

- 收回 12 处内部符号的 `export`（`API_ERRORS`、`TOKEN_PATTERN`、`CONFIG_DIR`、`MODEL_ALIASES`、
  `DEFAULT_MODEL`、`DIMENSIONS`、`WECHAT_CLIENT_ID`、`batchTasks`、`getSuiteTask`、`mimeOf` 等），
  删除未使用的 `red` 颜色常量
- 扩图的外扩量计算抽成纯函数 `expansionForTarget`，便于测试与复用
- 登录页 `/api/*` 的内部错误码（`BODY_TOO_LARGE` / `BAD_JSON`）转成中文提示
- Windows 下读取剪贴板失败时给出可执行提示，不再抛原始 ENOENT
- 帮助信息补「别名」一行（`me / credits / draw / create / taotu / xiangqing / ls / dl`）

### Added

- 测试从 66 增至 72：扩图比例计算 4 条、登录错误码映射 2 条

## [0.6.0] - 2026-11-26

### Added

- **`pwish expand` 图像扩展**：按目标画幅（`--to 16:9`）或四边比例（`--left/--right/--top/--bottom`，0-1）外扩，
  已实测（512×512 扩到 16:9，返回 `image1`-`image4`）
- `resultUrls` 兼容 `image1`-`image4` 与 `ori_image*`（原图占位不下载）
- 扩图接入额度预检与回读（`image_expand_num`），补扩图参数与结果解析测试

## [0.5.0] - 2026-11-26

### Added

- `resolveTask`：`pwish task` / `pwish download` 自动识别任务来源——对话式任务（`image-messages`）、
  套图 / 详情图任务（`tasks/login/suite`）、会话 id（`image/conversations`），三种 id 都能直接查与重下
- `test/resolve-task.test.js`：覆盖未知 id 占位对象、对话式、套图、会话回退四条路径

### Fixed

- 套图 / 详情图任务此前查不到（误用对话式批量接口，返回 `15027 not found`）
- 批量接口对任意未知 id 都会返回 `state=15021` 的占位对象，导致 `pwish task` 把无效 id 误报成「已过期」；
  现在按 `message_id`/`task_id` 是否为空判定，无效 id 正常显示「未找到」
- `pwish download <conversation_id>` 不再被占位对象截胡

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
