# pwish

**佐糖 AI 设计师的官方账号登录 + 命令行出图工具。** 一句话出电商图、商品图成套出图，结果自动下载到本地。

<p>
  <a href="https://www.npmjs.com/package/pwish-cli"><img alt="npm" src="https://img.shields.io/npm/v/pwish-cli?color=5555FF"></a>
  <a href="https://www.npmjs.com/package/pwish-cli"><img alt="downloads" src="https://img.shields.io/npm/dm/pwish-cli"></a>
  <a href="https://github.com/pwish-cli/pwish-cli/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/pwish-cli/pwish-cli/ci.yml?branch=main"></a>
  <img alt="node" src="https://img.shields.io/node/v/pwish-cli">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

```bash
npm i -g pwish-cli
pwish login                                   # 本机登录页，微信扫码或账号密码
pwish gen "白底商品图，柔和影棚光" -i ./mug.jpg   # 出图并自动下载
pwish suite -i ./mug.jpg --selling "白瓷马克杯 350ml" --scenes main,selling
```

> 非官方工具：账户额度的消耗、图片水印与内容合规规则由佐糖账号与站点政策决定。

## 目录

- [安装](#安装) · [登录](#登录) · [命令](#命令) · [例子](#例子)
- [模型](#模型) · [接口说明](#接口说明随站点更新可能变化) · [Skill](#skill)
- [开发与测试](#开发与测试) · [已知限制](#已知限制)

## 特性

| | |
|---|---|
| **本机登录页** | 微信扫码 / 手机号邮箱密码，视觉与官网一致，凭据不落盘 |
| **一句话出图** | 支持参考图、模型、比例、清晰度、张数与经济/稳定模式 |
| **电商套图** | 商品图 → AI 写场景提示词 → 白底/卖点/材质/模特成套出图 |
| **结果管理** | 任务查询、历史会话、队列状态、过期链接重下 |
| **零依赖** | 只用 Node 内置模块，含 LevelDB/Snappy 与 PKCE 的自实现 |

## 安装

```bash
npm i -g pwish-cli     # 从 npm 安装
# 或在仓库内：npm link
```

需要 Node.js ≥ 20（使用内置 `fetch`）。**无第三方运行时依赖。**

## 开发与测试

```bash
npm run verify   # = npm run check + npm test（CI 同一套）
npm run check    # 自检：语法 / 未使用 import / 硬编码凭证 / 输出层规范
npm test         # node --test，46 个用例
npm run test:watch
```

测试覆盖：模型 payload 分族构造、套图结果解析、配置与 token 解析、参数解析、
OAuth 授权码/PKCE/CSRF/Host 防护、Snappy 解压与 varint 解码、CLI `--version`。
**测试不产生任何 API 请求、不消耗额度。** CI（`.github/workflows/ci.yml`）在 Node 20 / 22 上跑同一套。

| 文件 | 职责 |
|---|---|
| `src/api.js` | 同源接口客户端（Bearer、错误码映射、超时） |
| `src/upload.js` | OSS STS 上传（V1 签名 + `x-oss-callback` 换 resource_id） |
| `src/tasks.js` | 建会话 / 建任务 / 批量轮询 / 下载 / 历史 / 队列 |
| `src/suite.js` | 电商套图两步流程（AI 写提示词 → 批量出图） |
| `src/models.js` | **模型表、比例尺寸表、场景表、payload 构造（改版时的主要改点）** |
| `src/auth-server.js` | 本机授权服务：登录页 + OAuth 授权码 + PKCE |
| `src/passport.js` | 官方账号登录接口客户端（扫码 / 密码） |
| `src/login-page.js` | 自建登录页与结果页（对齐官网视觉） |
| `src/browser-token.js` | 只读解析 Chromium localStorage（LevelDB + Snappy） |
| `src/args.js` / `src/output.js` | 参数解析 / 输出与着色（stdout/stderr 分离） |
| `src/cli.js` | 命令路由与业务编排 |
| `scripts/check.js` | 零依赖静态自检 |
| `test/` | 单元与 CLI 冒烟测试 |

版本与变更记录见 `CHANGELOG.md`；许可证见 `LICENSE`（MIT + 非官方工具免责声明）。

## 登录

```bash
pwish login
```

命令会在本机 `127.0.0.1` 启动一个**自建登录页**并自动打开浏览器：

- **微信扫码**：页面直接展示官方生成的二维码，手机上确认即可；
- **密码登录**：手机号或邮箱 + 密码。

登录凭据只交给本机服务，由它调用官方账号接口换取登录态，密码不保存、不外传。
拿到登录态后页面提示「授权完成」，终端自动继续。

### 为什么是本机页面

网页端的登录态只能由官方接口签发。为了让 CLI 也能正当地登录，本机起了一个临时授权服务，
页面视觉与佐糖官网登录页一致（品牌紫蓝渐变、白卡片、相同输入框规格），
底层复用官方登录接口，不接触任何第三方：

1. `pwish login` 起服务，生成 `state` 与 PKCE(S256) 参数，打开授权页；
2. 用户在页面上登录 → 本机服务调用官方接口换取 `api_token`；
3. 服务签发一次性授权码（60 秒、单次使用），页面跳回 `/callback`；
4. CLI 校验 `state` 与 PKCE 后收下 token，写入配置。

### 其他入口

| 命令 | 场景 |
|---|---|
| `pwish login --no-open` | 不自动开浏览器，只打印授权链接（远程/SSH） |
| `pwish login --port 8765` | 指定回环端口（默认随机） |
| `pwish login --token 'v2,...'` | CI / 无浏览器环境直接给 token |
| `pwish login --paste` | 从剪贴板读 token |
| `pwish whoami` / `pwish quota` / `pwish logout` | 账号 / 额度 / 退出 |

安全设计：
- 只 `listen` 在 `127.0.0.1`，校验 `Host` 头，防 DNS rebinding；
- `state` 防 CSRF 且一次性；PKCE S256 把授权码绑死在本客户端；
- 授权码一次性、60 秒过期；token 只经 POST body 与内存传递，不进 URL、不进日志；
- 密码只在一次请求中透传给官方接口，不落盘；
- 凭证存 `~/.config/pwish/config.json`，权限 `0600`。

环境变量：

| 变量 | 作用 |
|---|---|
| `PWISH_TOKEN` | 临时覆盖 token |
| `PWISH_OUT` | 默认输出目录 |
| `PWISH_API_BASE` | 覆盖接口域名（默认 `https://aw.aoscdn.com/app/picwish`） |
| `PWISH_PASSPORT_BASE` | 覆盖账号登录接口域名 |
| `PWISH_CONFIG_DIR` | 覆盖配置目录 |
| `PWISH_DEBUG` | 出错时打印原始响应/堆栈 |

## 命令

```bash
pwish whoami                          # 当前账号
pwish quota                           # 免费额度（按模型）
pwish models                          # 模型 / 比例 / 清晰度表

pwish gen "提示词" -i 参考图 [-m 模型] [-r 比例] [-s 2K] [--mode economy|stable] [-n 张数] [-o 目录]
pwish suite -i 商品图 [--selling "卖点"] [--site amazon] [--scenes main,core,selling,material,person]

pwish history [--limit 20]
pwish show <conversation_id>
pwish task <task_id> [...]
pwish download <task_id|conversation_id> [-o 目录]
pwish queue
```

全局开关：`--json`（机器可读）、`-o/--out`（输出目录，默认 `out/`）、`--version`（版本号）。

`--mode` 支持 `economy`（默认）与 `stable`；**`stable` 参数会正确下发但尚未实测**出图效果与计费差异。

## 例子

```bash
# 白底主图
pwish gen "纯白色背景，商品居中占画面85%，柔和影棚光，高细节" -i ./mug.jpg -m gpt-image-2 -r 1:1 -s 2K

# 电商套图：亚马逊，5 个可用场景里的 3 个
pwish suite -i ./mug.jpg --selling "简约白瓷马克杯 350ml，可微波加热" \
  --site amazon --scenes main,selling,material

# 一次出 3 张备选
pwish gen "白底商品图，柔和阴影" -i ./mug.jpg -n 3 -o out/v1
```

## 模型

| key | id | 说明 |
|---|---|---|
| `gemini-3` | 6 | 电商模型 3.0（最强，10-20 算粒/张） |
| `nano-banana-pro` | 72 | 电商模型 2.0 |
| `nano-banana-2-lite` | 61 | 电商模型 1.0（最便宜） |
| `gpt-image-2` | 195 | GPT Image 2（补贴通用模型，3-5 算粒/张） |
| `gpt-image-2-flare` | 89 | GPT Image 2 Flare |
| `gpt-image-1.5` | 190 | GPT Image 1.5 |
| `gpt-image-1` | 83 | GPT Image 1 |
| `gemini-2.5` | 154 | Gemini 2.5 Flash Image |
| `seedream-5-pro` / `-flash` / `5.5` | 78 / 79 / 94 | Seedream 系列 |
| `jimeng-4.5` | 41 | 即梦 4.5 |
| `flux` | 1 | FLUX |

比例：`auto 1:1 2:3 3:2 3:4 4:3 9:16 16:9`；清晰度：`1K 2K 2K+`（→ standard/high/super）。

### 场景（`--scenes`）

电商套图支持 5 个场景，均已实测：`main`(白底主图) `core`(核心卖点图) `selling`(卖点图) `material`(材质图) `person`(模特展示图)。
站点 UI 还有「场景展示图」「多场景拼图」两个选项，其接口参数尚未确认，CLI 暂不支持。

## 接口说明（随站点更新可能变化）

基址 `https://aw.aoscdn.com/app/picwish`，`Authorization: Bearer <passport_api_token>`，
所有请求带 `product_id=482&language=zh`。

| 用途 | 接口 |
|---|---|
| 额度 | `GET vips/all-free-counts` |
| 建会话 | `POST image/conversations` |
| 一句话出图 | `POST tasks/login/image-messages` |
| 批量查任务 | `GET tasks/login/image-messages/batch?task_ids=` |
| 队列 | `GET image/conversations/task-queue` |
| 会话列表/详情 | `GET image/conversations`、`GET image/conversations/{id}` |
| 套图：AI 写提示词 | `POST tasks/login/suite/prompt` → `GET tasks/login/suite/prompt/{task_id}` |
| 套图：出图 | `POST tasks/login/suite` → `GET tasks/login/suite/{task_id}` |
| 上传授权 | `POST authorizations/oss`（STS，随后 PUT 到 OSS 带 `x-oss-callback` 换 `resource_id`） |

生成结果轮询到 `state=1`（或 `progress=100`）后，`answer[].file` 即图片 URL（OSS 签名约 2 小时有效）。

## Skill

`skill/pwish/SKILL.md` 是为 agent 准备的用法协议（额度预检、模型选择、套图配方、错误码处理、提示词方法论）。
安装到 agent 技能目录即可：

```bash
cp -R skill/pwish ~/.agents/skills/pwish
```

## 已知限制

**能力边界**（没做 / 没验证，不要当成能用）：

- **详情图（电商详情图）未实现**：站点有该功能，CLI 尚未支持，无对应命令。
- **视频生成未实现**：接口存在（`tasks/login/video-messages`），未验证也未封装。
- **套图场景 5/7**：见上文「场景」，「场景展示图」「多场景拼图」不支持。
- **`--mode stable` 未实测**：参数正确下发，但只验证过 `economy`。
- **浏览器直读仅限 Chromium 系**：Chrome / Edge / Brave / Chromium / Arc / Vivaldi 可用；
  **Safari 与 Firefox 不支持**，会自动回退到网页 OAuth。
- **上传单文件上限 20MB**（CLI 侧保护）。实际站点限制未逐一验证。

**产品与环境限制**：

- 免费额度生成的图片**带水印**（URL/文件名含 `-wm_`）；去水印需按站点规则付费。
- 结果图片 URL 是签名链接（约 2 小时），过期需用 `pwish download` 重新拉（会自动重新查询拿新签名）。
- 接口无公开文档，字段以实测为准；站点改版可能导致失效，`src/models.js` 是模型/比例/场景的单一改点。
- 读取浏览器 localStorage 依赖磁盘布局，Chromium 大版本改动格式时可能失效（届时回退 OAuth）。
