---
name: pwish
description: 用 `pwish` 命令行工具调用佐糖（picwish.cn）的图片能力：一句话生图、电商套图、电商详情图、抠图去背景、变清晰、高清修复、商品还原/白底、幽灵模特、平铺图、去褶皱、图像扩展、图片翻译、AI 换背景、去水印、去杂物、黑白上色、格式转换，并把结果下载到本地。当用户要生成商品图/电商图/白底图/场景图/模特图/套图/详情图，或要抠图、去背景、换背景、去水印、修图、放大清晰化、给老照片上色、改图片格式，以及提到佐糖/picwish/AI 设计师时使用。
---

# 佐糖 AI 设计师（pwish CLI）

本 skill 让你通过 `pwish` 命令行出电商图。生成能力来自 picwish 网页版同源接口，
算粒/额度按账号走，生成图片**默认带水印**（免费额度）。

## 0. 开工前检查（每次都做）

```bash
pwish whoami   # 有用户 ID 说明登录态可用；同时给出会员身份与算粒
pwish quota    # 生图模型 / 设计任务 / 图片工具 三类免费次数一次看全
```

- `whoami` 失败（退出码 3）→ 走 §1 登录。
- 官方批量套图（`suite-batch`）与 AI 阴影都**只走算粒**，免费额度计数不参与放行；这类请求在免费账号上
  必然失败，不要反复重试，也不要向用户承诺"再等等就能用"。
- `quota` 中目标额度为 0 → 告诉用户「该项免费次数已用完」，给出表里的替代项；
  **不要承诺「明天就恢复」**——实测翻译/扩图跨天后并没有回补，恢复规则以站点为准
  （同表其它还有次数的模型），不要硬跑、也不要自己编造额度数字。
- CLI 自己也会做预检：`gen` / `suite` / 各图片工具在额度为 0 时会直接拦下（退出码非 0），
  并把可换的模型列出来。**看到这个拦截不要加 `--force` 硬冲**，先向用户确认是否还有会员权益。
- 每个任务跑完 CLI 会打印一行额度，并标注本次是否真的扣了：
  `（本次 消耗 N）` 表示计数下降，`（站点计数未变化）` 表示这个工具的计数不随调用变化——
  后者**不是失败**，不要因此重试或告诉用户“额度没扣成功”。
- 报 `CREDIT_NOT_ENOUGH`（算粒不足）说明免费次数之外还要算粒：把用户引到 `pwish quota` 看余额，
  或建议换便宜模型 / 升级会员，不要原样重试。
- 不要自己猜 API、不要直接用 curl 打接口：CLI 已经封装了上传、轮询、下载与错误码。

## 1. 登录

```bash
pwish login
```

在本机 `127.0.0.1` 起一个自建登录页并打开浏览器，用户在页面上：
- **微信扫码** 直接登录，或
- 输入 **手机号 / 邮箱 + 密码** 登录。

拿到登录态后页面显示「授权完成」，终端自动继续，无需复制任何 token。

| 场景 | 命令 |
|---|---|
| 远程 / SSH（不自动开浏览器） | `pwish login --no-open` 后手动打开打印出的链接 |
| 指定端口 | `pwish login --port 8765` |
| CI / 无浏览器 | `pwish login --token 'v2,...'` |

登录态存 `~/.config/pwish/config.json`（0600）。**不要**把 token 写进仓库、日志或最终回答。
需要让用户自己登录时，提示他直接跑 `pwish login`，不要索要账号密码。

## 2. 一句话出图：`pwish gen`

```bash
pwish gen "<提示词>" [-i 参考图 ...] [-m 模型] [-r 比例] [-s 2K] [--mode economy|stable] [-n 张数] [-o 目录]
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `-i/--image` | 本地文件路径，可重复 | 参考图（商品原图），单文件 ≤ 20MB。会先上传拿 resource_id |
| `-m/--model` | `gemini-3`(默认) `nano-banana-pro` `nano-banana-2-lite` `gpt-image-2` `gpt-image-1.5` `seedream-5-pro` … | `pwish models` 看全表 |
| `-r/--ratio` | `auto`(默认) `1:1` `3:4` `4:3` `9:16` `16:9` `2:3` `3:2` | 参考图是商品图时，`1:1` 最稳妥 |
| `-s/--size` | `1K` `2K`(默认) `2K+` | 实际像素由比例×档位决定，2K 约 2048px |
| `--mode` | `economy`(默认) `stable`(稳定) | **只有 nano-banana / gpt-image-2 两族会下发 `pattern`**，其余模型传了无效；stable 的出图与计费差异未实测 |
| `-n` | 整数，默认 1 | 同提示词并发出多张 |
| `-o/--out` | 目录，默认 `out/` | 下载目录 |
| `--json` | 开关 | 机器可读输出，便于后续处理 |

模型选择经验：
- **电商/商品图**：`gemini-3`（最强国模，贵）→ `gpt-image-2`（便宜且有补贴）→ `nano-banana-2-lite`（最便宜）。
- **纯文生图、无参考图**：`gpt-image-2` 或 `seedream-5-pro` 性价比高。
- 先用 `nano-banana-2-lite` 试构图，满意再换 `gemini-3` 出终稿，省额度。

## 3. 电商套图：`pwish suite`（最常用）

一张商品图 → AI 写各场景提示词 → 批量出一套电商图。

```bash
pwish suite -i ./product.jpg \
  --selling "简约白瓷马克杯 350ml，可微波加热，适合办公室" \
  --site amazon --scenes main,selling,material -o out/
```

| 参数 | 说明 |
|---|---|
| `-i` | 商品图，**必填**，可多张（同一产品） |
| `--selling` | 商品卖点。**写得越具体，成图越准**：产品名 + 核心卖点 + 适用人群 + 期望场景 + 参数 |
| `--site` | `amazon`(默认) `taobao` `temu` `pdd` `shein` `ozon` `tiktok` `douyin` `shopee` `kuaishou` `xiaohongshu` `ali` `jd` `walmart` `coupang` |
| `--scenes` | `main`(白底主图) `core`(核心卖点图) `selling`(卖点图) `material`(材质图) `person`(模特展示图) —— 只有这 5 个可用 |
| `--no-plan` | 跳过「AI 写提示词」这一步，直接把空 prompts 交给出图接口（站点会用默认提示词）。想控制每个场景的文案，目前只能不加该参数、让 AI 写 |
| `-m --size --ratio` | 同 gen；套图默认 `gemini-3 / 2K / 1:1` |

`--site` 会同时决定站点默认的语言与地区（如 amazon→US/en、taobao→CN/zh、ozon→RU/ru），
图上的文案语言随之变化。需要覆盖时加 `--lang` `--country`。

**每多一个 scene 就多一次模型调用**，注意额度：先用 1-2 个场景试，确认风格后再跑全套。

**没有的能力**（用户要时直接说明做不到，别尝试用现有命令硬凑）：电商视频、
套图的「场景展示图 / 多场景拼图」两个场景。站点上有这些功能，CLI 尚未支持。

## 3.4 电商详情图：`pwish detail`

一张商品图 + 卖点 → 详情页各个模块图，每个模块自带文案版式。

```bash
pwish detail -i ./product.jpg --selling "简约白瓷马克杯 350ml，可微波加热" \
  --site amazon --scenes poster,feature,detail -o out/detail
```

| 参数 | 说明 |
|---|---|
| `-i` | 商品图，必填，可多张 |
| `--selling` | **必填**。详情图每个模块都要写文案，卖点写得越具体成图越准 |
| `--scenes` | 默认 `poster,highlights,feature,detail`；可选 `poster`(海报) `highlights`(亮点合集) `feature`(卖点) `detail`(细节) `lifestyle`(场景生活) `scenes`(多场景) `dimensions`(尺寸标注) |
| `--site / --country / --lang` | 同套图，决定文案语言与站点风格 |
| `-m --size --ratio --mode` | 同 gen；默认 `gemini-3 / 2K / 1:1 / economy` |

流程与套图的区别：详情图会先按场景让 AI 写「带排版描述的提示词」，再逐场景出图，
结果按场景命名下载（`<时间戳>-detail-<scene>.png`）。**每个场景都是一次模型调用**，
先挑 2-3 个场景试风格再跑全套。

额度口径与套图分开：`pwish quota` 里的「详情图」一行就是它。

## 3.5 图片工具：一图一任务

不走对话、不需提示词（`bg` 除外），一张图进、一张图出，几秒到一分钟完成：

| 命令 | 作用 | 必填参数 | 输出 |
|---|---|---|---|
| `pwish cutout ./p.jpg` | 抠图去背景 | — | 透明底 PNG |
| `pwish upscale ./p.jpg` | 变清晰 / 放大 | — | JPG；`--type photo\|general\|text`，`--scale 2` |
| `pwish restore ./p.jpg` | 高清修复（模糊、低清、老照片） | — | JPG |
| `pwish whitebg -i ./p.jpg -i ./ref.jpg` | 商品还原 / 白底 | 正好 2 张图 | PNG |
| `pwish mannequin ./p.jpg` | 幽灵模特（服装 3D 图） | `--ratio`（默认 1:1） | PNG |
| `pwish flatlay ./p.jpg` | 平铺图（俯拍） | `--ratio`（默认 1:1） | PNG |
| `pwish wrinkle ./p.jpg` | 去衣服褶皱 | — | JPG |
| `pwish expand ./p.jpg --to 16:9` | 图像扩展 / 扩图 | `--to` 或 `--left/--top` | PNG |
| `pwish translate ./p.jpg --to ENG` | 图片翻译（换字保版式） | `--from/--to` 语言码 | JPG |
| `pwish bg ./p.jpg --prompt "..."` | AI 换背景（内部先抠图） | `--prompt` | 1-4 张 JPG 候选 |
| `pwish dewatermark ./p.jpg` | 自动去水印 | — | JPG |
| `pwish erase ./p.jpg --mask ./m.png` | 去杂物 / 擦除 | `--mask` 蒙版图 | PNG；`--strength 1-5` 默认 3 |
| `pwish colorize ./bw.jpg` | 黑白照片上色 | — | JPG |
| `pwish convert ./p.png --format jpg` | 格式转换 | — | `jpg/png/webp/bmp/gif` |
| `pwish batch <工具> <目录>` | 批量跑同一个工具 | 同单图参数 | 同该工具 |
| `pwish batch gen <目录> --prompt "..."` | 批量生图（每图一张） | `--prompt` 或 `--prompt-file` | 同 gen |

用法要点：

- **抠图后换背景**：`pwish bg` 已包含抠图，不用先跑 `cutout`；只要透明底就单独用 `cutout`。
- **`erase` 的蒙版**：白色（或任意非透明）区域 = 要擦掉的区域，尺寸应与原图一致。
  用户没有蒙版图时，请让他用任意画图工具涂一块再导出，别自称能自动识别。
- **组合流水线**：老照片修复常见顺序 `restore` → `colorize` → `dewatermark`，每步单独下载。
- **扩图**：`--to 16:9` 会按原图尺寸自动算左右外扩量；只想手动控制就用
  `--left/--right/--top/--bottom`（0-1 的比例，0.2 表示外扩原边长的 20%）。改比例前先确认用途，
  竖图转横图方向搞反会得到“被压扁”的构图。
- **批量前先估成本**：拿不准会花几次额度时，先加 `--dry-run`：
  `pwish suite -i ./p.jpg --selling "..." --dry-run` 会打印「预计消耗 N 次（当前剩余 M 次）」，
  不上传、不建任务、不扣额度。用户问"要花多少"时用它回答，不要靠猜。
- **批量**：`pwish batch cutout ./photos -o out/cut` 会对目录里所有图片依次跑同一个工具，
  逐张打印成败，任一张失败不影响其它张，最后汇总 `完成 N/M`；有失败时退出码为 1。
  开跑前会核对剩余额度，张数超过剩余次数会直接拦下（除非加 `--force`）。并发用
  `--concurrency 2`（默认 1，最多 4），并发越高越容易撞服务端限流。
- **批量生图**：`pwish batch gen ./photos --prompt "白底商品图"` 给每张图各生成一张，整批共用一个会话。
  `--prompt-file` 每行对应一张（顺序按文件名排序），只写 1 行则会复用到所有图；条数对不上会直接报错。
  批量生图按「张数 × --n」核对模型额度。
- **试衣**：没有独立命令，用双图 gen 代替——`pwish gen "把第二张图的衣服穿到第一张图的人身上"
  -i ./person.jpg -i ./shirt.jpg`。这是站点自己的实现路径（计费项 `virtualTryOnOrArt`）。
- **拼图**：站点是前端 canvas 合成，没有服务端接口，CLI 不做；需要排版时建议用 `pwish suite` 出图后自行拼接。
- **幽灵模特 / 平铺图**：同一件衣服分别出「隐形人台」和「铺平」效果，底层是同一个外部编辑接口，
  用 `from` 和 `quality` 区分；`--ratio` 只接受站点画幅（1:1 / 3:4 / 4:3 / 16:9 等）。
- **去褶皱**：`alpha` 是 0 以上数字，传布尔会被服务端拒（`must be equal or greater than 0`）。
- **商品还原/白底**：服务端**硬性要求正好 2 张源图**，少一张多一张都会报
  `product-restore requires exactly 2 source images`；用 `-i` 传两次。`--size` 控制画幅（默认 1:1）。
- **图片翻译**：默认中译英（`--from CHS --to ENG`），语言码用三字母大写（CHS/CHT/ENG/JPN/KOR/FRA/DEU/
  ESP/POR/PTB/ROM/RUS/VIN/ARA/THA）。译文替换画面文字、保留原有版式，适合把国内详情图换语种重投。
  源语言写 `auto` 服务端会直接返回 `task failed`（实测），CLI 已在本地拦掉并提示，按图片实际语种传 `CHS` 等语言码。
- **额度和生图分开**：这些工具走各自的免费次数，不受生图模型算粒影响；`pwish quota` 的「图片工具」
  一节能看到每个工具的**当前计数**（已用量字段语义未确认，CLI 不显示）。失败时报 `CREDIT_NOT_ENOUGH`
  通常就是次数用完了。
- 输出文件默认落在 `out/`，命名 `<原文件名>-<工具名>-<时间戳>`；`--no-download` 只打印 URL。

## 4. 结果查询与重下

```bash
pwish history [--limit 20]        # 历史会话（30 天内）
pwish show <conversation_id>      # 会话里每条任务与图片 URL
pwish task <task_id> [...]        # 任务状态（state=1 完成）
pwish download <task_id|conversation_id> -o dir   # 重新下载（OSS URL 会过期，及时下）
pwish queue                       # 服务端队列状态
```

## 5. 出错怎么办

| 现象 / 错误码 | 处理 |
|---|---|
| `CREDIT_NOT_ENOUGH` | 算粒不足。减少张数/换便宜模型（`gpt-image-2`、`nano-banana-2-lite`），或让用户充值 |
| `DAILY_LIMIT_EXCEEDED` | 今日免费额度用完，换模型或明天再试 |
| `INVALID_WORDS` / `IMAGE_POLICY_VIOLATION` | 提示词/图片违规。**改写提示词**（去掉品牌名、真人明星、敏感词），不要原样重试 |
| `SENSITIVE_IMAGE` | 参考图被判敏感，换一张图 |
| `UNAUTHORIZED` / 退出码 3 | 登录态过期 → 重新 `pwish login` |
| 等待超时（退出码 1） | 任务还在排队：用 `pwish task <id>` 或 `pwish queue` 看，别重复提交 |
| `INVALID_PARAM` | 参数不对：检查 `--ratio/--size/--scenes` 取值 |

## 6. 提示词方法论（决定成图质量）

一句话万能结构：**主体 + 材质细节 + 背景/场景 + 光线 + 构图 + 输出规格**。

- 白底图：`纯白色背景（RGB 255,255,255），商品居中，占画面 80-90%，仅展示完整产品，无道具无场景，柔和影棚光，高细节真实质感`
- 场景图：`<场景>，<材质>质感，<光线>，主体位于画面<位置>，<留白区> 留给文案`
- 细节图：`微距特写，聚焦<部位>，浅景深，背景虚化`
- 英文提示词对海外站点（amazon/walmart/temu）更稳，中文站点用中文。
- 一次只改一个变量（比例、光线、背景）做迭代，别整段重写——这样才能定位差异。

## 7. 交付与合规

- 生成文件在 `-o` 目录（默认 `out/`），命名 `<时间戳>-<task 前 8 位>.png`；套图带场景名。
- 免费额度的图**带水印**（文件名含 `-wm_`）。商用/无 watermark 需求 → 提示用户按站点规则升级会员。
- OSS 图片 URL 有签名有效期（约 2 小时），需要长期保存就下载到本地。
- 最终回答里给用户：本地文件路径 + 用到的提示词 + 模型/比例/张数 + 消耗的额度。

## 8. 常用配方

```bash
# 白底主图（淘宝/京东）
pwish gen "纯白色背景，商品居中占画面85%，柔和影棚光，高细节，电商主图" -i ./p.jpg -m gpt-image-2 -r 1:1 -s 2K

# 场景图（亚马逊）
pwish gen "现代木质餐桌场景，自然侧光，浅灰背景留白，商品居中偏右，商业摄影质感" -i ./p.jpg -m gemini-3 -r 1:1 -s 2K

# 九宫格备选：同提示词一次出 3 张
pwish gen "白底商品图，柔和阴影" -i ./p.jpg -n 3 -o out/v1

# 全套电商套图
pwish suite -i ./p1.jpg -i ./p2.jpg --selling "不锈钢保温杯 500ml，24小时保温，防漏盖，适合通勤" --site amazon --scenes main,core,selling,material,person
```
