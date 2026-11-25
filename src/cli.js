import fs from "node:fs";
import { createRequire } from "node:module";
import { parseArgs, readStdin } from "./args.js";
import { log, say, json, cyan, green, yellow, dim, reset } from "./output.js";
import { loadConfig, saveConfig, readCachedUser, writeCachedUser, UserError, CONFIG_PATH, userIdOfToken } from "./config.js";
import { createClient, loginWithToken, ApiError } from "./api.js";
import { startLoopbackAuth, openBrowser } from "./oauth.js";
import { findPassportToken } from "./browser-token.js";
import { execFileSync } from "node:child_process";
import { MODELS, RATIOS, SUITE_SCENES, SUITE_SITES, resolveModel, buildImageMessagePayload } from "./models.js";
import { uploadFiles } from "./upload.js";
import {
  createConversation,
  createImageMessage,
  waitForTasks,
  imagesOf,
  downloadImage,
  batchTasks,
  listConversations,
  getConversation,
  queueStatus,
  freeCounts,
} from "./tasks.js";
import { planSuitePrompts, generateSuite, suiteImagesOf } from "./suite.js";

/* -------------------------------- commands -------------------------------- */

async function persistToken(token, { json: asJson = false } = {}) {
  token = loginWithToken(token);
  const client = createClient({ token });
  const data = await freeCounts(client);
  const userId = userIdOfToken(token);
  saveConfig({ token });
  writeCachedUser({ userId, vip: Boolean(data.vip), verifiedAt: Date.now() });
  if (asJson) {
    json({ ok: true, tokenSavedTo: CONFIG_PATH, userId, vip: Boolean(data.vip) });
    return 0;
  }
  say(`${green}✓ 登录态已保存 → ${CONFIG_PATH}`);
  say(`  用户 ID: ${userId ?? "未知"}    会员: ${data.vip ? "是" : "否"}`);
  return 0;
}

async function tokenFromBrowser(args) {
  const hits = findPassportToken();
  if (!hits.length) return false;
  const hit = hits[0];
  log(`${dim}从已登录的浏览器（${hit.browser}）读取到登录态`);
  try {
    await persistToken(hit.token, { json: args.flags.json });
    return true;
  } catch (err) {
    log(`${yellow}浏览器里的登录态不可用（${err.message}），回退网页授权`);
    return false;
  }
}

async function oauthLogin(args) {
  const timeoutMs = Number(args.flags.timeout || 300) * 1000;
  const auth = await startLoopbackAuth({ timeoutMs, port: Number(args.flags.port || 0) });
  log(`${cyan}已开启本地授权服务 http://127.0.0.1:${auth.port}`);
  log(`${dim}OAuth 2.0 授权码 + PKCE(S256) · 仅监听 127.0.0.1 · 等待上限 ${Math.round(timeoutMs / 60000)} 分钟`);
  log("");

  const opened = args.flags["no-open"] ? false : await openBrowser(auth.authorizeUrl);
  if (opened) {
    log("已在浏览器打开授权页。按页面提示：登录佐糖 → 把「获取 pwish 授权」拖到书签栏 → 回佐糖页面点一下书签。");
  } else {
    log("无法自动打开浏览器，请手动访问：");
    log(`  ${auth.authorizeUrl}`);
  }
  log(`${dim}不方便用书签？授权页里也提供粘贴 token 的方式。`);

  try {
    const { token } = await auth.waitForToken();
    return await persistToken(token, { json: args.flags.json });
  } catch (err) {
    await auth.close();
    throw new UserError(`网页授权未完成：${err.message}。也可以直接 pwish login --token 'v2,...'`, "OAUTH_FAILED");
  }
}

async function cmdLogin(args) {
  let token = args.flags.token || args._[1] || "";
  if (!token && !process.stdin.isTTY && !args.flags.paste) token = await readStdin();

  // 优先从已登录的浏览器直接读取（零交互）；--token/--paste 保留手工入口
  if (!token && !args.flags.paste && !args.flags["no-browser"]) {
    if (await tokenFromBrowser(args)) return 0;
  }
  if (!token && !args.flags.paste) return oauthLogin(args);

  if (args.flags.paste) {
    try {
      token = execPaste();
    } catch (err) {
      throw new UserError("读取剪贴板失败。用 pwish login 走网页授权，或 pwish login --token 'v2,...'", "PASTE_FAILED");
    }
  }
  if (!token) throw new UserError("没有拿到 token", "NO_TOKEN_INPUT");
  return persistToken(token, { json: args.flags.json });
}

function execPaste() {
  // 只在 --paste 时用；延迟 require 保持顶层无副作用
  return execFileSync("pbpaste", { encoding: "utf8" }).trim();
}

function clientFromConfig(flags = {}) {
  const cfg = loadConfig();
  if (flags.base) cfg.apiBase = flags.base;
  return createClient(cfg);
}

async function cmdWhoami(args) {
  const client = clientFromConfig(args.flags);
  const data = await freeCounts(client);
  const cached = readCachedUser();
  const out = {
    userId: userIdOfToken(client.token),
    vip: Boolean(data.vip),
    apiBase: client.base,
    configPath: CONFIG_PATH,
    cached,
  };
  if (args.flags.json) return json(out), 0;
  say(`用户 ID: ${out.userId ?? "未知"}`);
  say(`会员: ${out.vip ? "是" : "否（免费额度用户）"}`);
  say(`接口: ${out.apiBase}`);
  say(`配置: ${out.configPath}`);
  return 0;
}

async function cmdQuota(args) {
  const client = clientFromConfig(args.flags);
  const data = await freeCounts(client);
  const groups = [
    ["Nano Banana 2（电商模型 2.0）", data.llm_chat_num_banana21],
    ["Gemini 3（电商模型 3.0）", data.llm_chat_num_gm30 ?? data.llm_chat_num_gem30],
    ["GPT Image 2", data.llm_chat_num_gpt2],
    ["Gemini 3.1", data.llm_chat_num_gem31],
    ["Nano Banana 2 Lite", data.llm_chat_num_gem31lite],
    ["即梦 5.0 Flash", data.llm_chat_num_jm50fla],
    ["套图任务", data.llm_chat_suite],
    ["详情图任务", data.llm_chat_detail],
    ["AI 图片编辑", data.image_edit_free_num],
    ["文生图", data.text_to_image_free_num],
  ].filter(([, v]) => v !== undefined);

  if (args.flags.json) return json({ vip: Boolean(data.vip), userId: userIdOfToken(client.token), groups: Object.fromEntries(groups) }), 0;
  say(`${cyan}免费额度（0 表示该模型免费次数已用完，需要算粒/会员）`);
  for (const [label, value] of groups) {
    say(`  ${String(label).padEnd(28)} ${value > 0 ? green + value + reset : dim + value + reset}`);
  }
  say(`${dim}会员：${data.vip ? "是" : "否"}`);
  return 0;
}

function cmdModels(args) {
  if (args.flags.json) return json(MODELS), 0;
  say(`${cyan}可用模型（-m / --model 取值）`);
  for (const [key, m] of Object.entries(MODELS)) {
    say(`  ${key.padEnd(20)} ${String(m.id).padEnd(5)} ${m.label}`);
  }
  say(`\n${cyan}比例: ${RATIOS.join(", ")}`);
  say(`${cyan}清晰度: 1K, 2K, 2K+（--size）`);
  say(`${cyan}模式: economy（经济，默认）, stable（稳定）`);
  return 0;
}

async function cmdGen(args) {
  let prompt = args._[1] || args.flags.prompt || "";
  if (args.flags["prompt-file"]) prompt = fs.readFileSync(args.flags["prompt-file"], "utf8").trim();
  else if (!prompt && !process.stdin.isTTY) prompt = await readStdin();
  if (!prompt) throw new UserError('缺少提示词。用法：pwish gen "一张白底商品图，简约风格" -i ./product.jpg');

  const model = resolveModel(args.flags.model || args.flags.m);
  const ratio = args.flags.ratio || args.flags.r || "auto";
  const sizeName = (args.flags.size || args.flags.s || "2K").toUpperCase();
  const pattern = (args.flags.mode || "economy").toLowerCase();
  const format = (args.flags.format || args.flags.f || "png").toLowerCase();
  const count = Math.max(1, Number(args.flags.n || 1));
  const images = [].concat(args.flags.image || args.flags.i || []);
  const outDir = args.flags.out || args.flags.o || loadConfig().outDir;
  const timeoutMs = Number(args.flags.timeout || 300) * 1000;
  const client = clientFromConfig(args.flags);

  if (!["economy", "stable"].includes(pattern)) throw new UserError("--mode 只能是 economy 或 stable");
  if (!RATIOS.includes(ratio)) throw new UserError(`--ratio 不支持 ${ratio}，可用：${RATIOS.join(", ")}`);

  let conversations = args.flags.conv || args.flags.conversation || null;

  let files = [];
  if (images.length) {
    log(`${dim}上传 ${images.length} 张参考图…`);
    files = (await uploadFiles(client, images)).map((f) => f.resourceId);
  }

  if (!conversations) {
    const conv = await createConversation(client);
    conversations = conv.conversation_id;
  }

  const payload = buildImageMessagePayload({
    prompt,
    conversationId: conversations,
    modelId: model.id,
    family: model.family,
    files,
    ratio,
    sizeName,
    pattern,
    format,
  });

  const tasks = [];
  for (let i = 0; i < count; i += 1) {
    const created = await createImageMessage(client, payload);
    tasks.push(created.task_id);
    log(`${dim}已提交 ${i + 1}/${count} · task ${created.task_id}`);
  }

  log(`${dim}等待生成（模型 ${model.key}，比例 ${ratio}，${sizeName}，${pattern}）…`);
  const done = await waitForTasks(client, tasks, {
    timeoutMs,
    onProgress: ({ taskId, state, progress }) => {
      if (progress > 0) log(`${dim}  ${taskId.slice(0, 8)} ${progress}%`);
    },
  });

  const results = [];
  for (const taskId of tasks) {
    const item = done.get(taskId);
    const imgs = imagesOf(item);
    results.push({ taskId, ok: imgs.length > 0 && !item?.failed, images: imgs, error: item?.error || "", raw: item });
  }

  const okCount = results.filter((r) => r.ok).length;
  if (!okCount) {
    const first = results.find((r) => !r.ok);
    throw new ApiError(`全部生成失败${first?.error ? `：${first.error}` : ""}`, { code: "GENERATION_FAILED", payload: first?.raw });
  }

  const downloaded = [];
  if (!args.flags["no-download"]) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const r of results) {
      for (const [i, img] of r.images.entries()) {
        const base = `${stamp}-${r.taskId.slice(0, 8)}${r.images.length > 1 ? `-${i + 1}` : ""}`;
        const saved = await downloadImage(img.url, outDir, base, format === "jpeg" ? ".jpg" : ".png");
        downloaded.push(saved);
      }
    }
  }

  if (args.flags.json) {
    json({
      conversationId: conversations,
      model: model.key,
      prompt,
      images: results.flatMap((r) => r.images.map((img) => ({ taskId: r.taskId, url: img.url, file: downloaded.find((d) => d.file.includes(r.taskId.slice(0, 8)))?.file || null }))),
      files: downloaded.map((d) => d.file),
      failed: results.filter((r) => !r.ok).map((r) => ({ taskId: r.taskId, error: r.error })),
    });
    return okCount === results.length ? 0 : 7;
  }

  say(`${green}✓ 完成 ${okCount}/${results.length} 张  会话: ${conversations}`);
  for (const d of downloaded) say(`  ${d.file} ${dim}(${(d.bytes / 1024).toFixed(0)} KB)`);
  for (const r of results.filter((x) => !x.ok)) say(`  ${yellow}! ${r.taskId} 失败: ${r.error || "无图片返回"}`);
  if (args.flags["no-download"]) {
    for (const r of results) for (const img of r.images) say(`  ${img.url}`);
  }
  return okCount === results.length ? 0 : 7;
}

async function cmdSuite(args) {
  const images = [].concat(args.flags.image || args.flags.i || []);
  if (!images.length) throw new UserError("套图需要至少 1 张商品图：pwish suite -i ./product.jpg --selling \"产品名 + 卖点\"");
  const selling = args.flags.selling || args._[1] || "";
  const site = (args.flags.site || "amazon").toLowerCase();
  if (!SUITE_SITES[site]) throw new UserError(`未知站点 ${site}，可用：${Object.keys(SUITE_SITES).join(", ")}`);

  const sceneList = (args.flags.scenes || "main,core,selling").split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = sceneList.filter((s) => !SUITE_SCENES[s]);
  if (unknown.length) {
    throw new UserError(`未知场景 ${unknown.join(", ")}。可用：${Object.keys(SUITE_SCENES).map((k) => `${k}(${SUITE_SCENES[k]})`).join(", ")}`);
  }

  const model = resolveModel(args.flags.model || args.flags.m || "gemini-3");
  const sizeName = (args.flags.size || args.flags.s || "2K").toUpperCase();
  const ratio = args.flags.ratio || args.flags.r || "1:1";
  const pattern = (args.flags.mode || "economy").toLowerCase();
  const outDir = args.flags.out || args.flags.o || loadConfig().outDir;
  const timeoutMs = Number(args.flags.timeout || 900) * 1000;
  const client = clientFromConfig(args.flags);

  log(`${dim}上传 ${images.length} 张商品图…`);
  const uploaded = await uploadFiles(client, images);
  const resourceIds = uploaded.map((u) => u.resourceId);

  let sellingPoints = selling;
  let prompts = {};
  if (!args.flags["no-plan"]) {
    log(`${dim}AI 正在根据商品图写各场景提示词…`);
    const plan = await planSuitePrompts(client, {
      resourceIds,
      sellingPoints: selling || "（未提供卖点，请根据图片合理推断产品名称与核心卖点）",
      site,
      country: args.flags.country,
      lang: args.flags.lang,
      scenes: sceneList,
      size: ratio,
    });
    prompts = plan.prompts || {};
    if (!sellingPoints && plan.raw?.selling_points) sellingPoints = plan.raw.selling_points;
    log(`${dim}已生成 ${Object.keys(prompts).length} 个场景提示词`);
  }

  log(`${dim}开始出图（${sceneList.join(", ")} · ${model.key} · ${sizeName}）…`);
  const out = await generateSuite(client, {
    resourceIds,
    sellingPoints,
    prompts,
    scenes: sceneList,
    site,
    country: args.flags.country,
    lang: args.flags.lang,
    model: model.key,
    sizeName,
    ratio,
    pattern,
    conversationId: args.flags.conv || args.flags.conversation,
    timeoutMs,
    onProgress: ({ state, progress }) => {
      if (progress > 0) log(`${dim}  ${progress}%`);
    },
  });

  const byScene = suiteImagesOf(out.raw);
  const sceneKeys = Object.keys(byScene);
  const total = sceneKeys.reduce((n, k) => n + byScene[k].length, 0);
  if (!total) {
    throw new ApiError("套图任务完成但没有返回图片", { code: "GENERATION_FAILED", payload: out.raw });
  }

  const downloaded = [];
  if (!args.flags["no-download"]) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const [scene, imgs] of Object.entries(byScene)) {
      for (const [i, img] of imgs.entries()) {
        const base = `${stamp}-suite-${scene}${imgs.length > 1 ? `-${i + 1}` : ""}`;
        const saved = await downloadImage(img.url, outDir, base, ".png");
        downloaded.push({ scene, ...saved });
      }
    }
  }

  if (args.flags.json) {
    json({
      ok: true,
      conversationId: out.conversationId,
      model: model.key,
      site,
      scenes: byScene,
      files: downloaded.map((d) => ({ scene: d.scene, file: d.file })),
      prompts,
      sellingPoints,
    });
    return 0;
  }

  say(`${green}✓ 套图完成 ${total} 张  会话: ${out.conversationId}`);
  for (const d of downloaded) say(`  [${d.scene}] ${d.file} ${dim}(${(d.bytes / 1024).toFixed(0)} KB)`);
  return 0;
}

async function cmdTask(args) {
  const ids = args._.slice(1);
  if (!ids.length) throw new UserError("用法：pwish task <task_id> [...]");
  const client = clientFromConfig(args.flags);
  const map = await batchTasks(client, ids);
  const out = ids.map((id) => {
    const item = map[id];
    if (!item) return { taskId: id, found: false };
    return {
      taskId: id,
      found: true,
      state: item.state ?? item.status,
      progress: item.progress,
      model: item.model_type,
      error: item.error || "",
      images: imagesOf(item).map((i) => i.url),
      conversationId: item.conversation_id,
    };
  });
  if (args.flags.json) return json(out), 0;
  for (const r of out) {
    if (!r.found) {
      say(`${yellow}${r.taskId} 未找到`);
      continue;
    }
    say(`${r.taskId}  state=${r.state} progress=${r.progress}%  ${r.error || ""}`);
    for (const u of r.images) say(`  ${u}`);
  }
  return 0;
}

async function cmdHistory(args) {
  const client = clientFromConfig(args.flags);
  const data = await listConversations(client, { page: Number(args.flags.page || 1), perPage: Number(args.flags.limit || 20) });
  const items = data?.items || [];
  if (args.flags.json) return json(items), 0;
  if (!items.length) return say("暂无历史会话"), 0;
  for (const it of items) {
    const when = it.created_at ? new Date(it.created_at * 1000).toLocaleString("zh-CN") : "";
    say(`${it.conversation_id}  ${dim}${when}  ${it.title || "(无标题)"}`);
  }
  return 0;
}

async function cmdShow(args) {
  const convId = args._[1] || args.flags.conv;
  if (!convId) throw new UserError("用法：pwish show <conversation_id>");
  const client = clientFromConfig(args.flags);
  const data = await getConversation(client, convId);
  const items = (data?.items || []).map((item) => ({
    taskId: item.task_id || item.message_id,
    prompt: item.prompt,
    model: item.model_type,
    state: item.state ?? item.status,
    images: imagesOf(item).map((i) => i.url),
  }));
  if (args.flags.json) return json({ conversationId: convId, title: data?.title, items }), 0;
  say(`${cyan}${data?.title || "(无标题)"}  ${convId}`);
  for (const it of items) {
    say(`- ${it.taskId}  model=${it.model} state=${it.state}`);
    say(`  ${dim}${(it.prompt || "").slice(0, 100).replace(/\n/g, " ")}`);
    for (const u of it.images) say(`  ${u}`);
  }
  return 0;
}

async function cmdDownload(args) {
  const id = args._[1];
  if (!id) throw new UserError("用法：pwish download <task_id|conversation_id> [-o dir]");
  const client = clientFromConfig(args.flags);
  const outDir = args.flags.out || args.flags.o || loadConfig().outDir;
  let urls = [];

  const map = await batchTasks(client, [id]).catch(() => ({}));
  if (map[id]) urls = imagesOf(map[id]).map((i) => i.url);
  if (!urls.length) {
    const conv = await getConversation(client, id);
    urls = (conv?.items || []).flatMap((item) => imagesOf(item).map((i) => i.url));
  }
  if (!urls.length) throw new UserError(`没有找到任务或会话 ${id} 的图片`, "NOT_FOUND");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const files = [];
  for (const [i, url] of urls.entries()) {
    const saved = await downloadImage(url, outDir, `${stamp}-${i + 1}`);
    files.push(saved.file);
    say(saved.file);
  }
  if (args.flags.json) json({ files });
  return 0;
}

async function cmdQueue(args) {
  const client = clientFromConfig(args.flags);
  const data = await queueStatus(client);
  if (args.flags.json) return json(data), 0;
  say(`状态: ${data?.task_queue_status || "unknown"}  运行中: ${data?.running_count ?? 0}  排队: ${data?.queued_count ?? 0}`);
  for (const job of data?.running_list || []) {
    say(`  ${job.message_id}  ${job.queue_status}/${job.dispatch_status}  ${(job.prompt || "").slice(0, 40)}`);
  }
  return 0;
}

function cmdLogout() {
  saveConfig({ token: "" });
  say("已清除本地登录态");
  return 0;
}

function help() {
  say(`pwish — 佐糖 AI 设计师命令行工具（picwish.cn/ai-design-create）

${cyan}登录
  pwish login                    浏览器授权（推荐，本地回环 + PKCE）
  pwish login --no-browser       不从浏览器读，强制走网页授权
  pwish login --no-open          只打印授权链接，自己在浏览器打开
  pwish login --token 'v2,...'   CI/无浏览器环境直接给 token
  pwish login --paste            从剪贴板读 token
  pwish whoami                   查看当前账号
  pwish quota                    查看免费额度
  pwish logout

${cyan}一句话出图（AI 设计师对话式生图）
  pwish gen "<提示词>" [-i 参考图 ...] [-m 模型] [-r 比例] [-s 2K] [--mode economy|stable] [-n 张数] [-o 输出目录]
  例：pwish gen "白底商品图，柔和影棚光" -i ./mug.jpg -m gemini-3 -r 1:1 -s 2K

${cyan}电商套图（商品图 → 多场景成套图）
  pwish suite -i ./product.jpg [--selling "产品名+卖点"] [--site amazon] [--scenes main,core,selling,material,person]
  可选：-m 模型 --size 2K --ratio 1:1 -o 输出目录

${cyan}查询与下载
  pwish task <task_id> [...]    查询任务状态
  pwish history [--limit 20]    历史会话
  pwish show <conversation_id>  会话详情
  pwish download <id> [-o dir]  重新下载图片
  pwish queue                   查看任务队列

${cyan}其他
  pwish models                  列出模型/比例/清晰度
  全局：--json 机器可读输出   --out/-o 输出目录（默认 out/，可用 PWISH_OUT 覆盖）

${dim}接口来自 picwish 网页版同源 API，生成图片带水印（免费额度），商用请按站点规则升级。
`);
  return 0;
}

const require = createRequire(import.meta.url);

export async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || "help";
  if (args.flags.version || args.flags.v || cmd === "--version" || cmd === "-v") {
    say(`pwish ${require("../package.json").version}`);
    return 0;
  }
  if (args.flags.help || cmd === "help" || cmd === "--help") return help();

  switch (cmd) {
    case "login":
      return cmdLogin(args);
    case "logout":
      return cmdLogout(args);
    case "whoami":
    case "me":
      return cmdWhoami(args);
    case "quota":
    case "credits":
      return cmdQuota(args);
    case "models":
      return cmdModels(args);
    case "gen":
    case "draw":
    case "create":
      return cmdGen(args);
    case "suite":
    case "taotu":
      return cmdSuite(args);
    case "task":
      return cmdTask(args);
    case "history":
    case "ls":
      return cmdHistory(args);
    case "show":
      return cmdShow(args);
    case "download":
    case "dl":
      return cmdDownload(args);
    case "queue":
      return cmdQueue(args);
    default:
      log(`未知命令：${cmd}\n`);
      help();
      return 2;
  }
}
