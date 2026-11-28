# Changelog

本项目所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.18.8] - 2026-11-28

### Chore

- `npm test` 改为串行执行（`--test-concurrency=1`）：CI 的 Node 24 上并行跑偶发整步挂死
  （0.18.6 / 0.18.7 两次各挂 10~12 分钟，本地复现不了）。串行后本地 15~22s，
  且一旦再挂，日志最后一个文件就是嫌疑点，便于定位

## [0.18.7] - 2026-11-28

### Fixed

- **CI 偶发挂住**（同一份测试 0.18.5 用 21s 跑完、0.18.6 却卡 10 分钟）：给 `startAuthServer`
  的 `shutdown()` 也加上 3s 兜底计时器（此前只有 e2e 假服务有），个别 Node 版本上
  `server.close()` 回调可能迟迟不来

### Chore

- `npm test` 加 `--test-timeout=120000`：卡住的用例会明确失败，而不是让 job 一直挂着
- CI 加 `timeout-minutes: 12` 兜底

## [0.18.6] - 2026-11-28

### Docs

- 补齐 0.18.3 / 0.18.4 / 0.18.5 的 CHANGELOG 条目（前两次发版只改代码、漏写记录）
- README 测试数量同步到 143

## [0.18.5] - 2026-11-28

### Fixed（严重回归）

- **0.18.1 起所有带下载的命令都会崩**：重构时间戳时漏了 `timestamp()` / `safeName()` 的 import，
  任何 `cutout / upscale / whitebg / suite / detail / gen`（未显式 `--no-download`）都会抛
  `timestamp is not defined`。0.18.1~0.18.4 受影响，本版修复
- 用真实接口复跑抠图确认下载恢复（302 KB PNG 落盘）

### Tests

- 新增 `test/e2e-tools.test.js`（4 条端到端）：`whitebg` 完整链路（2 图上传 → 建任务 → 轮询 → 落盘，
  断言 `source_resource_ids` 长度 2、`from=product-restore`）、`whitebg` 单图零请求、
  `batch cutout --concurrency 2 --json`（3 文件、JSON 可解析、实测并发峰值 ≤ 2）、`batch` 未知工具零请求
- 新增两个测试注入点：`src/net.js`（`setFetch` 替换 HTTP 出口）、`src/output.js`
  （`setSink` 收集结果行，避免改 `process.stdout` 吞掉测试报告）
- 测试 139 → 143

## [0.18.4] - 2026-11-27

### Fixed

- 假服务关闭改为「先 `closeAllConnections()` 再 `close()` + 3s 兜底计时器（`unref()`）」：
  keep-alive 连接会让 `server.close()` 在 CI 的 Node 22/24 上间歇挂住，两次挂起 7~16 分钟

## [0.18.3] - 2026-11-27

### Fixed

- 假服务关闭时先 `closeAllConnections()` 再 `close()`（第一次修复，Node 22 仍会挂，见 0.18.4）

## [0.18.2] - 2026-11-27

### Fixed

- `waitForTasks` 与 `pollTask` 对齐失败优先级：`state<0` 即使同时带 `progress=100` 和 `answer`
  也判失败（此前可能把失败任务当成功，输出一张实际不存在的图）

### Tests

- 假服务关闭时先 `closeAllConnections()` 再 `close()`，并加 3s 兜底：keep-alive 连接会让
  `server.close()` 在 CI 的 Node 22/24 上间歇挂住（本地复现不了，被测到两次）；
  兜底计时器 `unref()`，不影响正常退出
- 新增**零网络端到端测试**（`test/e2e-gen.test.js`）：本地假服务模拟 `POST /image/conversations`、
  `POST image-messages`、`GET image-messages/batch`，真实 spawn CLI 验证完整链路：
  建 N 任务、`--json` 输出结构、任务失败退出码、非法 `-n` 零请求（135 → 139）
- 端到端用例顺带锁死 `gen --json` 的 `images[] = {taskId,url,file}` 结构

## [0.18.1] - 2026-11-27

### Security / Fixed

- **文件名消毒**：结果文件名会拼进服务端返回的 `scene`/任务片段与原始文件名，
  现在统一清掉路径分隔符、Windows 保留字符、控制字符与首尾点（`src/filename.js`），
  防止 `../` 之类的内容把文件写到目标目录之外
- **下载/上传补超时**：结果下载 120s、上传 PUT 180s、抠图结果拉取 120s；
  此前 `fetch` 没有 `AbortSignal`，网络卡住会无限挂起

### Changed

- 时间戳生成从 6 处重复实现收敛到 `timestamp()`（统一 `2026-11-27T10-30-00` 格式，Windows 可用）
- `npm run release`：发布前校验 + 打 `vX.Y.Z` 标签；**补打历史标签 v0.7.0 ~ v0.18.0**
  （此前一直用 `npm version --no-git-tag-version` 发布，仓库里一个 tag 都没有）

### Chore

- `scripts/check.js` 新增两条自检：`src/` 里禁止 `process.exit`、`fetch` 必须带超时；
  新增 `test/filename.test.js`（5 条）与下载超时用例（129 → 135）

## [0.18.0] - 2026-11-27

### Changed

- **npm 包从 698 kB 降到 79 kB**：两张登录截图（616 kB）留在仓库、README 改用 GitHub raw 链接，
  不再塞进 tarball；新增 `npm run pack:size` 守卫（上限 300 kB），已接入 `verify` 与 CI

### Added

- `NO_COLOR` / `FORCE_COLOR` 支持：管道默认无色，`NO_COLOR=1` 强制关，`FORCE_COLOR=1` 强制开

### Tests

- 新增颜色策略契约测试（128 → 129）

## [0.17.0] - 2026-11-27

### Security

- **登录凭据交接加固**：`/api/qrcode`、`/api/qrcode/poll`、`/api/login/password`、`/session`
  除 `state` 外还要求 `User-Agent` 与打开登录页的浏览器一致；凭据只交接一次（第二次 409）；
  二维码轮询 800ms 节流。此前本机其他进程读到登录页拿到 `state` 就能换到 token

### Added

- `pwish history --all`：翻页拉全量会话（最多 20 页）
- GET 请求遇到 502/503/504 自动重试（POST 仍绝不重试，避免重复建任务）
- README 补代理用法：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=...`（Node 24+ 内置，不引依赖）

### Tests

- 新增 UA 不符 403、凭据二次交接 409、轮询节流 429 三条用例
- `startAuthServer` 支持注入 `pollQr`，登录相关用例不再依赖上游网络
- API 客户端补「GET 502 重试 / POST 不重试」用例（124 → 128）

## [0.16.2] - 2026-11-27

### Docs

- README 补 `pwish quota --json` 的输出结构，说明 `tools` / `models` 是「剩余次数」数字映射
- 修正额度统计口径：查询固定带 `website=zh`（此前不传 cfg 会退化成 en，同一账号在两侧计数不同，
  例如 `jimeng-5-flash` 在 en 侧显示 3、zh 侧为 0）

## [0.16.1] - 2026-11-27

Codex 指出的「测试给假绿」与几处额度/模型小 bug，一并修掉。测试 123 → 124。

### Fixed

- **`vip:"0"` 被判成会员**：站点把布尔位当字符串给，`Boolean("0")` 为真；改为 `toFlag()` 按数值/字符串判断
- **额度查询默认退化到英文站**：`freeCounts(client)` 不传 cfg 时 `website` 变成 `en`，改为默认 `zh`
- **`-m jimeng-5-flash` 报「未知模型」**：额度表里有它但 CLI 没摸到 `model_type`，
  现在明确提示「站点可用、CLI 未接入」

### Tests

- **授权码一次性**：原用例在服务已关闭后才重放，「拒绝」其实来自连不上；改为服务存活时重放，
  断言 400 + 授权码提示
- **CODE_TTL**：原来只断言常量；改为注入 `codeTtlMs: 0` 走真实的过期分支
- **OSS V1 签名**：原来在测试里复制了一份签名实现自证；改为直接调生产函数 `ossV1Signature` 比对
- **格式转换别名**：原来只断言「不是不支持的格式」，`ENOENT` 也能过；改为断言真的发出 `format: jpg`
- **`/api/*` 错误**：原来会真的打上游、只断言「不是 HTML」；改为本地坏 JSON，断言 500 + JSON + 文案
- 补临时目录清理（batch / upload / exit-code）；CI 矩阵加 Node 24

### Docs

- SKILL 的 `--no-plan` 与 `--mode stable` 描述按实现纠正（`--no-plan` 并不会带自定义提示词）

## [0.16.0] - 2026-11-27

全面复核（含 Codex 独立审查）后的加固批次。测试 113 → 123。

### Security

- **登录事务隔离**：`/api/qrcode`、`/api/qrcode/poll`、`/api/login/password`、`/session` 四个接口
  现在都必须带匹配的 `state`，二维码缓存按 `state` 绑定；`/health` 不再回显 `state`。
  此前本机其他进程可以凭空轮询二维码接口拿到 token
- **结果地址白名单**：下载与换背景只允许 `https` + `*.aliyuncs.com` / `*.aoscdn.com` / `*.picwish.cn`；
  上传授权返回的 OSS 域名必须是阿里云，防止服务端返回的地址把请求带到任意主机
- **配置写入**：先写 `0600` 临时文件再 rename，消除 0644 窗口期；环境变量覆盖值不再被固化进配置文件

### Fixed

- `pollTask` 先判断 `state<0` 再判断 `progress===100`，失败任务不再被当成成功
- HTTP 401/5xx 不再被 body 里的 `status:200` 掩盖
- 响应体读取纳入超时保护（此前只限制到首字节）
- 拼错的选项直接报错（`--dryrun` 以前会静默变成真跑，可能白扣额度）
- `--force=false` / `--dry-run=no` 正确解析为关闭；`--prompt=a=b` 不再被截断；
  `--image=` 与 `-i` 混用时不会把字符串拆成字符
- `-n 1.5` / `-n 0` / `-n 11` 在本地报错，不再让服务端兜底
- `batch --json` 输出可被 `JSON.parse`（逐条进度改走 stderr）
- `batch gen --no-download` 按 URL 判定成功，不再全部记为失败
- `batch whitebg` 明确拒绝（每张图需配一张参考图，目录批量语义不成立）
- `pwish task` 有查不到的 id 时退出码 1（文本与 `--json` 一致）
- 未登录退出码统一为 3（此前 `NO_TOKEN` 落进通用分支返回 2），新增退出码契约测试
- `quota` 文本表补上去褶皱 / 幽灵模特 / 平铺图
- `--dry-run --json` 输出结构化 JSON（`{dryRun, action, steps, remain, enough}`）
- 上传一张失败即中止后续，不再继续烧带宽

### Removed

- `pwish login --paste`（剪贴板读 token）整体移除：与「自建登录页走官方 OAuth」的既定交互冲突，
  CI 场景用 `--token`

### Docs

- 测试数量、`--mode stable`（只有 `nano-banana` / `gpt-image-2` 会下发 `pattern`）、
  「今日已用」（并未显示）、`download` 重下机制（重新查询而非本地签名）等描述按实现纠正
- 新增命令别名与全局开关说明；README 安全设计章节重写

### Chore

- CI 增加 `npm run format:check`
- 测试临时目录补清理；`auth-server` 补 2 条 state 隔离用例

## [0.15.2] - 2026-11-27

### Research → 文档纠正

抓了试衣页（`/virtual-try-on-clothes`）与拼图页（`/product-collage-maker`）的依赖树
（420 + 202 个 chunk），结论修正了之前「找不到接口」的模糊说法：

- **AI 试衣没有独立任务接口**：页面只是把用户导进 AI 设计师，计费项在设计师成本表里叫
  `virtualTryOnOrArt`（会员 12 / 免费 5）。等价于「双图 gen」：人像 + 衣服，
  用 `pwish gen "把第二张图的衣服穿到第一张图的人身上" -i person.jpg -i shirt.jpg`
- **拼图是前端 canvas 合成**：页面里只有 `vips/task/deduct` 的计费埋点（`source: TypeVisualCollage`），
  没有建任务端点；零依赖下 CLI 不做本地合成

README / SKILL 已按这个结论改写，不再写「找不到服务端接口」这类含糊说法。

## [0.15.1] - 2026-11-27

### Fixed

- `pwish help` 漏掉了 `wrinkle / mannequin / flatlay` 三个新命令（0.15.0 里替换锚点没命中且没有断言）

### Tests

- 新增 `test/help.test.js`：遍历 `TOOLS` 断言每个工具在 help 里都有用法行，并检查
  `--dry-run / --quiet / --force / --json` 四个全局开关（111 → 113）。以后新增工具漏写帮助会直接红

## [0.15.0] - 2026-11-27

### Added

- **`pwish wrinkle` 去褶皱**：`POST tasks/login/external/remove-wrinkle`（`alpha` 必为 0 以上数字，
  传布尔报 `must be equal or greater than 0`），实测出图，额度 4 → 3
- **`pwish mannequin` 幽灵模特**（服装 3D 图 / 隐形人台）：`gem-image-edit` + `from=ghost-model`
  + `model_type=195` + `quality=default`，实测出图（1.4 MB PNG），额度 2 → 0
- **`pwish flatlay` 平铺图**：同一接口 `from=flat-lay` + `quality=high`，实测出图（1 MB PNG），额度 2 → 1
- 抽出 `garmentBody()` 纯函数，补 2 条参数测试（109 → 111）

### Research

- 这三个能力是从服装工具页的 chunk 树（295 个文件）里挖出来的，取代了之前「找不到服务端接口」的结论
- `aspect_ratio` 只接受站点画幅枚举（1:1/16:9/9:16/3:7/7:3/4:3/3:4/2:3/3:2/9:21/21:9 及几个商品图尺寸）；
  传 `auto` 会报 400

## [0.14.0] - 2026-11-27

### Added

- **`--dry-run`**：只读一次额度就返回计划，打印「预计消耗 N 次（当前剩余 M 次）」，
  额度不足时提示正式执行会被拦下。覆盖 `gen / suite / detail / batch / 全部图片工具`，
  不上传图片、不建任务
- 同一次命令内重复上传同一文件只真上传一次（按「前缀+路径+大小+mtime」记忆），
  失败不缓存；跨进程不复用，避免拿到已失效的 resource_id

### Fixed

- 并发上传同一文件时，两个调用会各自发起一次授权请求（记忆的是结果而非进行中的 Promise）；
  改为缓存 in-flight Promise，实测并发两次只 PUT 一次

### Tests

- `test/upload.test.js` 补 1 条：同文件并发只上传一次、不同前缀各算一次（108 → 109）

## [0.13.1] - 2026-11-27

### Research → 已知限制

- 摸清官方批量套图 `POST tasks/login/suite-batch` 的入参结构：顶层 `model_type`、`size`、`site`、
  `country`、`lang`、`scene`、`items[]`，每个 item 必须带 `source_resource_ids`（否则
  `The SourceResourceIds field is required`）
- **该管线只走算粒**：结构正确后直接返回 `CREDIT_NOT_ENOUGH · insufficient VIP balance`，
  免费额度 `suite_batch=10` 不参与放行。免费账号无法端到端验证，因此不封装，记入已知限制
- 文档同步：README 已知限制补批量套图 / AI 阴影 / 商品还原两张图的硬性约束；SKILL 提醒不要重试

## [0.13.0] - 2026-11-27

### Added

- **`pwish whitebg` 商品还原/白底**：`POST tasks/login/external/gem-image-edit`（`from=product-restore`，
  `provider_model=72`），结果在 `answer[].file`，已实测出图（939 KB PNG），额度 4 → 3
  - 服务端硬性要求**正好 2 张源图**：`-i` 传两次，少/多都会报 15026
  - 参数踩坑记录：`resolution` 只接受 `standard/high/super`（传 `2k` 报 400）；
    `template_type` 必须在 1-6（不传报 15026）
  - 接入额度预检与回读（`product_restore`）

### Research

- 官方批量套图接口已定位：`POST tasks/login/suite-batch`、`GET .../groups/recent`、
  `POST .../groups/resume`、`PUT .../sub-tasks/{id}/title`、`GET .../history`、`.../tags`、
  `.../results/retry`。创建入参对象所在的批量页 chunk 尚未抓到，暂不实现

## [0.12.0] - 2026-11-27

### Changed

- 多图上传改为 3 路并发（`uploadFiles`），保持返回顺序；实测 2 张图 2572ms → 487ms
- `pollTask` 容忍偶发查询失败（默认连续 5 次才放弃），单次网络抖动不再让几分钟的任务作废；
  进度回调额外带 `elapsedMs`

### Tests

- 新增 `test/poll.test.js` 6 条：正常完成、偶发失败恢复、连续失败放弃、state<0 立即失败、
  超时提示、已用时长透传（101 → 107）

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
