---
name: pwish
description: 用 `pwish` 命令行工具调用佐糖 AI 设计师（picwish.cn/ai-design-create）做电商图：一句话生图、商品图换场景、白底主图、电商套图，并把结果下载到本地。当用户要生成商品图、电商图、白底图、场景图、模特图、套图，或提到佐糖/picwish/AI 设计师/一句话出图时使用。
---

# 佐糖 AI 设计师（pwish CLI）

本 skill 让你通过 `pwish` 命令行出电商图。生成能力来自 picwish 网页版同源接口，
算粒/额度按账号走，生成图片**默认带水印**（免费额度）。

## 0. 开工前检查（每次都做）

```bash
pwish whoami   # 有用户 ID 说明登录态可用；报错则按 §1 登录
pwish quota    # 看免费额度；额度为 0 时不要盲目提交，先告知用户
```

- `whoami` 失败（退出码 3）→ 走 §1 登录。
- `quota` 中目标模型的次数为 0 → 直接告诉用户「该模型免费次数已用完，需要算粒/会员」，不要硬跑。
- 不要自己猜 API、不要直接用 curl 打接口：CLI 已经封装了上传、轮询、下载与错误码。

## 1. 登录（通常零交互）

```bash
pwish login
```

按优先级自动选路径：
1. **读已登录浏览器**（默认）：从本机 Chrome/Edge/Brave/Chromium/Arc/Vivaldi/Ego Lite 的 localStorage
   只读提取佐糖 token。用户只要在浏览器登录过佐糖，就什么都不用做。
   （Safari / Firefox 不支持，会自动落到第 2 步。）
2. **网页 OAuth 兜底**：读不到时在本地回环起服务走 OAuth 授权码 + PKCE（只监听 127.0.0.1），
   浏览器里拖一个授权书签、在佐糖页面点一下即可。
3. **手工**：`pwish login --token 'v2,...'`、`--paste`（CI/无浏览器环境）。
   取 token：浏览器登录 <https://picwish.cn/ai-design-create> → Console →
   `copy(localStorage.getItem('passport_api_token'))`。

`pwish login --no-browser` 可强制跳过浏览器读取、走网页授权。

登录态存 `~/.config/pwish/config.json`（0600）。**不要**把 token 写进仓库、日志或最终回答。

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
| `--mode` | `economy`(默认，便宜) `stable`(稳定，贵) | 参数会正确下发，但**只实测过 economy**，stable 的出图/计费差异未验证 |
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
| `--no-plan` | 跳过 AI 写卖点这一步（自己已想好提示词时用，省一次任务） |
| `-m --size --ratio` | 同 gen；套图默认 `gemini-3 / 2K / 1:1` |

`--site` 会同时决定站点默认的语言与地区（如 amazon→US/en、taobao→CN/zh、ozon→RU/ru），
图上的文案语言随之变化。需要覆盖时加 `--lang` `--country`。

**每多一个 scene 就多一次模型调用**，注意额度：先用 1-2 个场景试，确认风格后再跑全套。

**没有的能力**（用户要时直接说明做不到，别尝试用现有命令硬凑）：电商详情图、电商视频、
套图的「场景展示图 / 多场景拼图」两个场景。站点上有这些功能，但 CLI 尚未逆向/封装。

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
