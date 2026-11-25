import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadConfig, saveConfig, readCachedUser, writeCachedUser, UserError, CONFIG_PATH, userIdOfToken } from "./config.js";
import { createClient, loginWithToken, ApiError } from "./api.js";
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

const CYAN = process.stdout.isTTY ? "\u001b[36m" : "";
const GREEN = process.stdout.isTTY ? "\u001b[32m" : "";
const YELLOW = process.stdout.isTTY ? "\u001b[33m" : "";
const DIM = process.stdout.isTTY ? "\u001b[2m" : "";
const RESET = process.stdout.isTTY ? "\u001b[0m" : "";

function log(msg) {
  process.stderr.write(`${msg}\n`);
}
function say(msg) {
  process.stdout.write(`${msg}\n`);
}
function json(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

/* ------------------------------- arg parsing ------------------------------ */

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  const takesValue = new Set([
    "model", "m", "ratio", "r", "size", "s", "mode", "format", "f", "n", "out", "o",
    "image", "i", "conv", "conversation", "timeout", "poll", "token", "selling", "site",
    "country", "lang", "scenes", "prompt-file", "limit", "page", "comment",
  ]);
  for (let idx = 0; idx < argv.length; idx += 1) {
    const a = argv[idx];
    if (a === "--") {
      args._.push(...argv.slice(idx + 1));
      break;
    }
    if (a.startsWith("--")) {
      const [rawKey, inline] = a.slice(2).split("=");
      const key = rawKey.trim();
      if (inline !== undefined) {
        args.flags[key] = inline;
      } else if (key === "json" || key === "no-download" || key === "paste" || key === "stdin" || key === "force" || key === "help" || key === "no-plan" || key === "keep") {
        args.flags[key] = true;
      } else if (takesValue.has(key)) {
        const next = argv[idx + 1];
        if (next === undefined || next.startsWith("-")) throw new UserError(`--${key} 需要一个值`);
        args.flags[key] = next;
        idx += 1;
      } else {
        args.flags[key] = true;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      const key = a.slice(1);
      if (takesValue.has(key)) {
        const next = argv[idx + 1];
        if (next === undefined) throw new UserError(`-${key} 需要一个值`);
        if (key === "i") {
          args.flags.image = [...(args.flags.image || []), next];
        } else {
          args.flags[key] = next;
        }
        idx += 1;
      } else if (key === "n") {
        args.flags.n = argv[++idx];
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

/* -------------------------------- commands -------------------------------- */

async function cmdLogin(args) {
  let token = args.flags.token || args._[1] || "";
  if (!token && args.flags.paste) {
    try {
      token = execFileSync("pbpaste", { encoding: "utf8" }).trim();
    } catch {
      throw new UserError("读取剪贴板失败（macOS 需要 pbpaste）。直接把 token 作为参数传入：xiutu login v2,...");
    }
  }
  if (!token && !process.stdin.isTTY) token = await readStdin();
  if (!token) {
    log(
      [
        "",
        `${CYAN}获取 token 的方法${RESET}`,
        "  1. 浏览器打开 https://picwish.cn/ai-design-create 并登录",
        "  2. DevTools → Console，执行： copy(localStorage.getItem('passport_api_token'))",
        "  3. 回到终端执行： xiutu login --paste",
        "",
        `  或者： xiutu login 'v2,...'     /     echo 'v2,...' | xiutu login`,
        "",
      ].join("\n"),
    );
    throw new UserError("缺少 token", "NO_TOKEN_INPUT");
  }

  token = loginWithToken(token);
  const client = createClient({ token });
  const data = await freeCounts(client);
  const userId = userIdOfToken(token);
  saveConfig({ token });
  writeCachedUser({ userId, vip: Boolean(data.vip), verifiedAt: Date.now() });
  if (args.flags.json) {
    json({ ok: true, tokenSavedTo: CONFIG_PATH, userId, vip: Boolean(data.vip) });
    return 0;
  }
  say(`${GREEN}✓ 登录态已保存${RESET} → ${CONFIG_PATH}`);
  say(`  用户 ID: ${userId ?? "未知"}    会员: ${data.vip ? "是" : "否"}`);
  return 0;
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
  say(`${CYAN}免费额度${RESET}（0 表示该模型免费次数已用完，需要算粒/会员）`);
  for (const [label, value] of groups) {
    say(`  ${String(label).padEnd(28)} ${value > 0 ? GREEN + value + RESET : DIM + value + RESET}`);
  }
  say(`${DIM}会员：${data.vip ? "是" : "否"}${RESET}`);
  return 0;
}

function cmdModels(args) {
  if (args.flags.json) return json(MODELS), 0;
  say(`${CYAN}可用模型${RESET}（-m / --model 取值）`);
  for (const [key, m] of Object.entries(MODELS)) {
    say(`  ${key.padEnd(20)} ${String(m.id).padEnd(5)} ${m.label}`);
  }
  say(`\n${CYAN}比例${RESET}: ${RATIOS.join(", ")}`);
  say(`${CYAN}清晰度${RESET}: 1K, 2K, 2K+（--size）`);
  say(`${CYAN}模式${RESET}: economy（经济，默认）, stable（稳定）`);
  return 0;
}

async function cmdGen(args) {
  let prompt = args._[1] || args.flags.prompt || "";
  if (args.flags["prompt-file"]) prompt = fs.readFileSync(args.flags["prompt-file"], "utf8").trim();
  else if (!prompt && !process.stdin.isTTY) prompt = await readStdin();
  if (!prompt) throw new UserError('缺少提示词。用法：xiutu gen "一张白底商品图，简约风格" -i ./product.jpg');

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
    log(`${DIM}上传 ${images.length} 张参考图…${RESET}`);
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
    log(`${DIM}已提交 ${i + 1}/${count} · task ${created.task_id}${RESET}`);
  }

  log(`${DIM}等待生成（模型 ${model.key}，比例 ${ratio}，${sizeName}，${pattern}）…${RESET}`);
  const done = await waitForTasks(client, tasks, {
    timeoutMs,
    onProgress: ({ taskId, state, progress }) => {
      if (progress > 0) log(`${DIM}  ${taskId.slice(0, 8)} ${progress}%${RESET}`);
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

  say(`${GREEN}✓ 完成 ${okCount}/${results.length} 张${RESET}  会话: ${conversations}`);
  for (const d of downloaded) say(`  ${d.file} ${DIM}(${(d.bytes / 1024).toFixed(0)} KB)${RESET}`);
  for (const r of results.filter((x) => !x.ok)) say(`  ${YELLOW}! ${r.taskId} 失败: ${r.error || "无图片返回"}${RESET}`);
  if (args.flags["no-download"]) {
    for (const r of results) for (const img of r.images) say(`  ${img.url}`);
  }
  return okCount === results.length ? 0 : 7;
}

async function cmdSuite(args) {
  const images = [].concat(args.flags.image || args.flags.i || []);
  if (!images.length) throw new UserError("套图需要至少 1 张商品图：xiutu suite -i ./product.jpg --selling \"产品名 + 卖点\"");
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

  log(`${DIM}上传 ${images.length} 张商品图…${RESET}`);
  const uploaded = await uploadFiles(client, images);
  const resourceIds = uploaded.map((u) => u.resourceId);

  let sellingPoints = selling;
  let prompts = {};
  if (!args.flags["no-plan"]) {
    log(`${DIM}AI 正在根据商品图写各场景提示词…${RESET}`);
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
    log(`${DIM}已生成 ${Object.keys(prompts).length} 个场景提示词${RESET}`);
  }

  log(`${DIM}开始出图（${sceneList.join(", ")} · ${model.key} · ${sizeName}）…${RESET}`);
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
      if (progress > 0) log(`${DIM}  ${progress}%${RESET}`);
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

  say(`${GREEN}✓ 套图完成 ${total} 张${RESET}  会话: ${out.conversationId}`);
  for (const d of downloaded) say(`  [${d.scene}] ${d.file} ${DIM}(${(d.bytes / 1024).toFixed(0)} KB)${RESET}`);
  return 0;
}

async function cmdTask(args) {
  const ids = args._.slice(1);
  if (!ids.length) throw new UserError("用法：xiutu task <task_id> [...]");
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
      say(`${YELLOW}${r.taskId} 未找到${RESET}`);
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
    say(`${it.conversation_id}  ${DIM}${when}${RESET}  ${it.title || "(无标题)"}`);
  }
  return 0;
}

async function cmdShow(args) {
  const convId = args._[1] || args.flags.conv;
  if (!convId) throw new UserError("用法：xiutu show <conversation_id>");
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
  say(`${CYAN}${data?.title || "(无标题)"}${RESET}  ${convId}`);
  for (const it of items) {
    say(`- ${it.taskId}  model=${it.model} state=${it.state}`);
    say(`  ${DIM}${(it.prompt || "").slice(0, 100).replace(/\n/g, " ")}${RESET}`);
    for (const u of it.images) say(`  ${u}`);
  }
  return 0;
}

async function cmdDownload(args) {
  const id = args._[1];
  if (!id) throw new UserError("用法：xiutu download <task_id|conversation_id> [-o dir]");
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
  say(`xiutu — 佐糖 AI 设计师命令行工具（picwish.cn/ai-design-create）

${CYAN}登录${RESET}
  xiutu login --paste            从剪贴板读取 passport_api_token（推荐）
  xiutu login 'v2,...'           直接传 token
  echo 'v2,...' | xiutu login    从 stdin 读取
  xiutu whoami                   查看当前账号
  xiutu quota                    查看免费额度
  xiutu logout

${CYAN}一句话出图（AI 设计师对话式生图）${RESET}
  xiutu gen "<提示词>" [-i 参考图 ...] [-m 模型] [-r 比例] [-s 2K] [--mode economy|stable] [-n 张数] [-o 输出目录]
  例：xiutu gen "白底商品图，柔和影棚光" -i ./mug.jpg -m gemini-3 -r 1:1 -s 2K

${CYAN}电商套图（商品图 → 多场景成套图）${RESET}
  xiutu suite -i ./product.jpg [--selling "产品名+卖点"] [--site amazon] [--scenes main,core,selling,material,person]
  可选：-m 模型 --size 2K --ratio 1:1 -o 输出目录

${CYAN}查询与下载${RESET}
  xiutu task <task_id> [...]    查询任务状态
  xiutu history [--limit 20]    历史会话
  xiutu show <conversation_id>  会话详情
  xiutu download <id> [-o dir]  重新下载图片
  xiutu queue                   查看任务队列

${CYAN}其他${RESET}
  xiutu models                  列出模型/比例/清晰度
  全局：--json 机器可读输出   --out/-o 输出目录（默认 out/，可用 XIUTU_OUT 覆盖）

${DIM}接口来自 picwish 网页版同源 API，生成图片带水印（免费额度），商用请按站点规则升级。${RESET}
`);
  return 0;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || "help";
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
