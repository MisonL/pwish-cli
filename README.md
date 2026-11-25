# xiutu

把 [佐糖 AI 设计师](https://picwish.cn/ai-design-create)（picwish AI Designer）封装成命令行工具，
并把用法写成一个 agent skill。一句话出电商图、商品图成套出图，结果自动下载到本地。

> 非官方工具：调用的是网页版同源接口，额度/水印/合规规则由佐糖账号决定。

## 安装

```bash
git clone <this-repo> ~/tools/xiutu-cli
cd ~/tools/xiutu-cli
npm link            # 或者把 bin/xiutu.js 加进 PATH
xiutu help
```

需要 Node.js ≥ 20（用到内置 `fetch`）。无第三方依赖。

## 登录

token 来自浏览器 localStorage 的 `passport_api_token`：

1. 浏览器打开 <https://picwish.cn/ai-design-create> 并登录
2. DevTools → Console：`copy(localStorage.getItem('passport_api_token'))`
3. 终端：`xiutu login --paste`

登录态保存在 `~/.config/xiutu/config.json`（权限 0600）。也可以用环境变量：

| 变量 | 作用 |
|---|---|
| `XIUTU_TOKEN` | 临时覆盖 token |
| `XIUTU_OUT` | 默认输出目录 |
| `XIUTU_API_BASE` | 覆盖接口域名（默认 `https://aw.aoscdn.com/app/picwish`） |
| `XIUTU_CONFIG_DIR` | 覆盖配置目录 |
| `XIUTU_DEBUG` | 出错时打印原始响应/堆栈 |

## 命令

```bash
xiutu whoami                          # 当前账号
xiutu quota                           # 免费额度（按模型）
xiutu models                          # 模型 / 比例 / 清晰度表

xiutu gen "提示词" -i 参考图 [-m 模型] [-r 比例] [-s 2K] [--mode economy|stable] [-n 张数] [-o 目录]
xiutu suite -i 商品图 [--selling "卖点"] [--site amazon] [--scenes main,core,selling,material,person]

xiutu history [--limit 20]
xiutu show <conversation_id>
xiutu task <task_id> [...]
xiutu download <task_id|conversation_id> [-o 目录]
xiutu queue
```

全局开关：`--json`（机器可读）、`-o/--out`（输出目录，默认 `out/`）。

## 例子

```bash
# 白底主图
xiutu gen "纯白色背景，商品居中占画面85%，柔和影棚光，高细节" -i ./mug.jpg -m gpt-image-2 -r 1:1 -s 2K

# 电商套图：亚马逊，7 个场景里的 3 个
xiutu suite -i ./mug.jpg --selling "简约白瓷马克杯 350ml，可微波加热" \
  --site amazon --scenes main,selling,material

# 一次出 3 张备选
xiutu gen "白底商品图，柔和阴影" -i ./mug.jpg -n 3 -o out/v1
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

## 接口（逆向所得，可能随站点更新变化）

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

`skill/xiutu/SKILL.md` 是为 agent 准备的用法协议（额度预检、模型选择、套图配方、错误码处理、提示词方法论）。
安装到 agent 技能目录即可：

```bash
cp -R skill/xiutu ~/.agents/skills/xiutu
```

## 已知限制

- 免费额度生成的图片**带水印**（URL/文件名含 `-wm_`）；去水印需按站点规则付费。
- 结果图片 URL 是签名链接，过期需用 `xiutu download` 重新拉（会自动重新查询拿新签名）。
- 接口无公开文档，字段以实测为准；站点改版可能导致失效，`src/models.js` 是模型/比例的单一改点。
