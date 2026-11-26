import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs, readStdin } from "./args.js";
import {
  removeBackground,
  upscale,
  changeBackground,
  removeWatermark,
  removeObject,
  restorePhoto,
  expandImage,
  colorize,
  convertFormat,
  resultUrls,
} from "./tools.js";
import { log, say, json, cyan, green, yellow, dim, reset } from "./output.js";
import { loadConfig, saveConfig, readCachedUser, writeCachedUser, UserError, CONFIG_PATH, userIdOfToken } from "./config.js";
import { createClient, loginWithToken, ApiError } from "./api.js";
import { startAuthServer, openBrowser } from "./auth-server.js";
import { execFileSync } from "node:child_process";
import { MODELS, RATIOS, SUITE_SCENES, SUITE_SITES, resolveModel, buildImageMessagePayload } from "./models.js";
import { uploadFiles } from "./upload.js";
import {
  createConversation,
  createImageMessage,
  waitForTasks,
  imagesOf,
  downloadImage,
  listConversations,
  getConversation,
  queueStatus,
  freeCounts,
  verifyToken,
  resolveTask,
  taskImageUrls,
} from "./tasks.js";
import { planSuitePrompts, generateSuite, suiteImagesOf } from "./suite.js";
import { DETAIL_SCENES, planDetailPrompts, generateDetail, detailImagesOf } from "./detail.js";
import { summarizeQuota, preflight, hasCredits, toolRemainOf, modelRemain } from "./quota.js";

/* -------------------------------- commands -------------------------------- */

async function persistToken(token, { json: asJson = false } = {}) {
  token = loginWithToken(token);
  const client = createClient({ token });
  await verifyToken(client);
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

async function oauthLogin(args) {
  const timeoutMs = Number(args.flags.timeout || 600) * 1000;
  let auth;
  try {
    auth = await startAuthServer({ timeoutMs, port: Number(args.flags.port || 0) });
  } catch (err) {
    throw new UserError(`无法启动本机授权服务：${err.message}`, "AUTH_SERVER_FAILED");
  }
  log(`${cyan}已启动本机授权服务${reset} http://127.0.0.1:${auth.port}`);
  log(`${dim}OAuth 2.0 授权码 + PKCE(S256) · 仅监听 127.0.0.1 · 等待上限 ${Math.round(timeoutMs / 60000)} 分钟${reset}`);
  log("");

  const opened = args.flags["no-open"] ? false : await openBrowser(auth.authorizeUrl);
  if (opened) {
    log("已在浏览器打开登录页，请用佐糖账号登录（微信扫码 或 手机号/邮箱 + 密码）。");
  } else {
    log("无法自动打开浏览器，请手动访问：");
    log(`  ${auth.authorizeUrl}`);
  }

  try {
    const { token } = await auth.waitForToken();
    return await persistToken(token, { json: args.flags.json });
  } catch (err) {
    await auth.close();
    throw new UserError(`登录未完成：${err.message}`, "OAUTH_FAILED");
  }
}

async function cmdLogin(args) {
  let token = args.flags.token || args._[1] || "";
  if (!token && !process.stdin.isTTY && !args.flags.paste) token = await readStdin();

  // 默认走本机登录页；--token / --paste 供 CI 与无浏览器环境使用
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
  // 只在 --paste 时用；各平台剪贴板读取命令
  const platform = process.platform;
  if (platform === "darwin") return execFileSync("pbpaste", { encoding: "utf8" }).trim();
  if (platform === "win32") return execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).trim();
  const candidates = [
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--output"]],
    ["wl-paste", []],
  ];
  for (const [cmd, args] of candidates) {
    try {
      return execFileSync(cmd, args, { encoding: "utf8" }).trim();
    } catch {
      /* try next */
    }
  }
  throw new Error("未找到剪贴板工具（需要 xclip / xsel / wl-paste）");
}

function clientFromConfig(flags = {}) {
  const cfg = loadConfig();
  if (flags.base) cfg.apiBase = flags.base;
  return createClient(cfg);
}

function describeMembership(quota) {
  const { membership, credits } = quota;
  if (!membership.isVip) {
    const credit = credits.free + credits.allFree;
    return credit > 0 ? `免费账号 · 算粒 ${credit}` : "免费账号 · 无算粒";
  }
  const parts = ["会员"];
  if (membership.licenseType && membership.licenseType !== "vip") parts.push(membership.licenseType);
  if (membership.expiredAt) {
    parts.push(`到期 ${new Date(membership.expiredAt * 1000).toLocaleDateString("zh-CN")}`);
  }
  if (credits.vipGeminiRemain) parts.push(`生图额度 ${credits.vipGeminiRemain}`);
  return parts.join(" · ");
}

async function cmdWhoami(args) {
  const client = clientFromConfig(args.flags);
  const quota = summarizeQuota(await freeCounts(client));
  const cached = readCachedUser();
  const out = {
    userId: userIdOfToken(client.token),
    vip: quota.membership.isVip,
    membership: quota.membership,
    credits: { free: quota.credits.free, allFree: quota.credits.allFree, vipGeminiRemain: quota.credits.vipGeminiRemain },
    apiBase: client.base,
    configPath: CONFIG_PATH,
    cached,
  };
  if (args.flags.json) return json(out), 0;
  say(`用户 ID: ${out.userId ?? "未知"}`);
  say(`身份: ${describeMembership(quota)}`);
  say(`接口: ${out.apiBase}`);
  say(`配置: ${out.configPath}`);
  return 0;
}

const QUOTA_ROWS = [
  ["Gemini 3（电商模型 3.0）", "gemini-3"],
  ["Nano Banana 2 / Gemini 3.1", "nano-banana-pro"],
  ["Nano Banana 2 Lite", "nano-banana-2-lite"],
  ["GPT Image 2", "gpt-image-2"],
  ["即梦 4.5", "jimeng-4.5"],
  ["即梦 5.0 Flash", "jimeng-5-flash"],
  ["Seedream 5 系列", "seedream-5-pro"],
];

const DESIGN_ROWS = [
  ["套图", "suite"],
  ["详情图", "detail"],
  ["AI 图片编辑", "edit"],
];

const TOOL_ROWS = [
  ["抠图", "cutout"],
  ["变清晰", "upscale"],
  ["高清修复", "restore"],
  ["图像扩展", "expand"],
  ["换背景", "bg"],
  ["去水印", "dewatermark"],
  ["去杂物", "erase"],
  ["上色", "colorize"],
  ["格式转换", "convert"],
];

/** 中文字符占两列，按显示宽度补齐。 */
function padDisplay(text, width) {
  let shown = 0;
  for (const ch of text) shown += /[\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF]/.test(ch) ? 2 : 1;
  return text + " ".repeat(Math.max(0, width - shown));
}

function quotaCell(remain, used) {
  if (remain === undefined) return `${dim}—${reset}`;
  const text = String(remain);
  const colored = remain > 0 ? `${green}${text}${reset}` : `${yellow}${text}${reset}`;
  return used === undefined ? colored : `${colored}${dim}（今日已用 ${used}）${reset}`;
}

/** 生成/处理前查一次额度，给出可读的预检结论。 */
async function checkQuota(client, { kind, key, label, force }) {
  let quota;
  try {
    quota = summarizeQuota(await freeCounts(client));
  } catch {
    return null; // 额度接口偶发失败不应阻断主流程
  }
  const result = preflight(quota, { kind, modelKey: key });
  if (result.level === "block" && !force) {
    throw new UserError(`${label}${result.message}`, "QUOTA_EXCEEDED");
  }
  if (result.level === "block") log(`${yellow}! ${label}${result.message}（--force 已跳过预检）${reset}`);
  return quota;
}

/** 任务结束后回读额度，给一行「还剩多少」的反馈。 */
async function quotaAfterRun(client, { kind, key, label }) {
  try {
    const quota = summarizeQuota(await freeCounts(client));
    const remain =
      kind === "tool" ? toolRemainOf(quota, key) : kind === "model" ? modelRemain(quota, key) : quota.designer[key];
    if (remain === undefined) return null;
    log(`${dim}额度：${label} 免费剩余 ${remain} 次${reset}`);
    return { remain };
  } catch {
    return null;
  }
}

async function cmdQuota(args) {
  const client = clientFromConfig(args.flags);
  const quota = summarizeQuota(await freeCounts(client));

  if (args.flags.json) {
    return (
      json({
        userId: userIdOfToken(client.token),
        membership: quota.membership,
        credits: quota.credits,
        models: quota.models,
        designer: quota.designer,
        tools: Object.fromEntries(Object.entries(quota.tools).map(([k, v]) => [k, v.remain ?? null])),
      }),
      0
    );
  }

  say(`${cyan}账号${reset}  ${describeMembership(quota)}`);
  const credit = quota.credits.free + quota.credits.allFree;
  if (credit > 0 || quota.credits.vipGeminiRemain > 0) {
    say(`${dim}     算粒 ${credit} · 会员生图额度 ${quota.credits.vipGeminiRemain}${reset}`);
  }

  say(`\n${cyan}生图模型（免费次数）`);
  for (const [label, key] of QUOTA_ROWS) {
    if (quota.models[key] === undefined) continue;
    say(`  ${padDisplay(label, 28)} ${quotaCell(quota.models[key])}`);
  }

  say(`\n${cyan}设计任务（免费次数）`);
  for (const [label, key] of DESIGN_ROWS) {
    if (quota.designer[key] === undefined) continue;
    say(`  ${padDisplay(label, 28)} ${quotaCell(quota.designer[key])}`);
  }

  say(`\n${cyan}图片工具（今日剩余次数）`);
  for (const [label, key] of TOOL_ROWS) {
    const { remain, used } = quota.tools[key] || {};
    say(`  ${padDisplay(label, 28)} ${quotaCell(remain, used)}`);
  }

  if (!hasCredits(quota) && !quota.membership.isVip) {
    say(`\n${dim}提示：0 表示今日免费次数已用完（次日重置）。会员用户的算粒/额度不在此表，`);
    say(`      需要时用 pwish quota --json 取原始字段，或直接在站点升级。${reset}`);
  }
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

function cmdSkill(args) {
  const builtin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skill", "pwish", "SKILL.md");
  // --dir 指向「技能根目录」（如 ~/.agents/skills），实际落到其下的 pwish/ 子目录
  const root = args.flags.dir;
  const targetDir = !root
    ? path.join(os.homedir(), ".agents", "skills", "pwish")
    : path.basename(path.resolve(root)) === "pwish"
      ? path.resolve(root)
      : path.join(path.resolve(root), "pwish");
  const target = path.join(targetDir, "SKILL.md");

  if (!fs.existsSync(builtin)) throw new UserError("当前安装中未包含 skill 文件", "NO_SKILL");

  if (args.flags.print) {
    say(fs.readFileSync(builtin, "utf8"));
    return 0;
  }
  if (args.flags.showpath) {
    say(builtin);
    return 0;
  }
  if (args.flags.install) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(builtin, target);
    log(`${green}✓${reset} skill 已安装 → ${target}`);
    log(`现在告诉 agent「用 pwish skill 生成一张电商图」即可。`);
    return 0;
  }

  say(`${cyan}agent skill 安装${reset}`);
  say(`  pwish skill --install           安装到 ${target}`);
  say(`  pwish skill --install --dir ROOT 安装到 ROOT/pwish（ROOT 为技能根目录）`);
  say(`  pwish skill --showpath           打印内置 skill 路径`);
  say(`  pwish skill --print             直接输出 SKILL.md 内容`);
  return 0;
}

const TOOLS = {
  cutout: { label: "抠图去背景", run: removeBackground, ext: ".png" },
  upscale: { label: "变清晰", run: upscale, ext: ".jpg" },
  bg: { label: "AI 换背景", run: changeBackground, ext: ".jpg" },
  dewatermark: { label: "去水印", run: removeWatermark, ext: ".png" },
  erase: { label: "去杂物", run: removeObject, ext: ".png" },
  restore: { label: "高清修复", run: restorePhoto, ext: ".jpg" },
  expand: { label: "图像扩展", run: expandImage, ext: ".png" },
  colorize: { label: "黑白上色", run: colorize, ext: ".png" },
  convert: { label: "格式转换", run: convertFormat, ext: "" },
};

async function cmdTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new UserError(`未知工具：${name}`, "UNKNOWN_TOOL");

  let image = args.flags.image || args.flags.i || args._[1] || "";
  if (!image) throw new UserError(`缺少输入图片。用法：pwish ${name} ./photo.jpg`, "NO_INPUT");
  if (!fs.existsSync(image)) throw new UserError(`文件不存在：${image}`, "NO_FILE");

  const outDir = args.flags.out || args.flags.o || loadConfig().outDir;
  const opts = { file: image, timeoutMs: Number(args.flags.timeout || 600) * 1000 };
  if (name === "upscale") {
    const t = String(args.flags.type || "").toLowerCase();
    opts.type = t === "photo" ? 0 : t === "text" ? 2 : 1;
    if (args.flags.scale) opts.scaleFactor = Number(args.flags.scale);
  }
  if (name === "restore" && args.flags.type) opts.type = Number(args.flags.type);
  if (name === "expand") {
    opts.to = args.flags.to || "";
    for (const edge of ["left", "right", "top", "bottom"]) {
      if (args.flags[edge] !== undefined) opts[edge] = args.flags[edge];
    }
  }
  if (name === "bg") {
    opts.prompt = String(args.flags.prompt || args.flags.p || "").trim();
    if (!opts.prompt) throw new UserError('缺少背景描述。用法：pwish bg ./product.jpg --prompt "纯白影棚背景"', "NO_PROMPT");
  }
  if (name === "erase") {
    const mask = args.flags.mask || "";
    if (!mask) throw new UserError("去杂物需要蒙版图。用法：pwish erase ./photo.jpg --mask ./mask.png", "NO_MASK");
    if (!fs.existsSync(mask)) throw new UserError(`蒙版文件不存在：${mask}`, "NO_FILE");
    opts.mask = mask;
    if (args.flags.strength) opts.strength = Number(args.flags.strength);
  }
  if (name === "convert") {
    opts.format = String(args.flags.format || args.flags.f || "png").toLowerCase();
  }

  const client = clientFromConfig(args.flags);

  await checkQuota(client, {
    kind: "tool",
    key: name,
    label: `${tool.label}：`,
    force: Boolean(args.flags.force),
  });

  log(`${dim}${tool.label}：${path.basename(image)}`);
  const { taskId, data } = await tool.run(client, opts);
  const urls = resultUrls(data);
  if (!urls.length) {
    throw new ApiError(`${tool.label}未返回图片`, { code: "NO_RESULT", payload: data });
  }

  const saved = [];
  if (!args.flags["no-download"]) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const [i, url] of urls.entries()) {
      const ext = tool.ext || `.${opts.format || "png"}`;
      const base = `${path.basename(image, path.extname(image))}-${name}${urls.length > 1 ? `-${i + 1}` : ""}-${stamp}`;
      saved.push(await downloadImage(url, outDir, base, ext));
    }
  }

  if (args.flags.json) {
    json({ tool: name, taskId, images: urls, files: saved.map((d) => d.file) });
    return 0;
  }
  say(`${green}✓ ${tool.label}完成${taskId ? `  任务: ${taskId}` : ""}`);
  for (const d of saved) say(`  ${d.file} ${dim}(${(d.bytes / 1024).toFixed(0)} KB)`);
  if (args.flags["no-download"]) for (const u of urls) say(`  ${u}`);
  await quotaAfterRun(client, { kind: "tool", key: name, label: tool.label });
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

  await checkQuota(client, {
    kind: "model",
    key: model.key,
    label: `模型 ${model.key}：`,
    force: Boolean(args.flags.force),
  });

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
  await quotaAfterRun(client, { kind: "model", key: model.key, label: model.key });
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

  await checkQuota(client, {
    kind: "design",
    key: "suite",
    label: "套图：",
    force: Boolean(args.flags.force),
  });

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
  await quotaAfterRun(client, { kind: "design", key: "suite", label: "套图" });
  return 0;
}

async function cmdDetail(args) {
  const images = [].concat(args.flags.image || args.flags.i || []);
  if (!images.length) throw new UserError('详情图需要至少 1 张商品图：pwish detail -i ./product.jpg --selling "产品名 + 卖点"');
  const selling = args.flags.selling || args._[1] || "";
  if (!selling) throw new UserError('详情图需要卖点（AI 要据此写每个模块的文案）：--selling "简约保温杯 500ml，24h 保温"', "NO_SELLING");
  const site = (args.flags.site || "amazon").toLowerCase();
  if (!SUITE_SITES[site]) throw new UserError(`未知站点 ${site}，可用：${Object.keys(SUITE_SITES).join(", ")}`);

  const requested = (args.flags.scenes || "poster,highlights,feature,detail")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const unknown = requested.filter((x) => !DETAIL_SCENES[x]);
  if (unknown.length) {
    throw new UserError(
      `未知详情图场景 ${unknown.join(", ")}。可用：${Object.entries(DETAIL_SCENES).map(([k, v]) => `${k}(${v})`).join(", ")}`,
    );
  }

  const model = resolveModel(args.flags.model || args.flags.m || "gemini-3");
  const sizeName = (args.flags.size || args.flags.s || "2K").toUpperCase();
  const ratio = args.flags.ratio || args.flags.r || "1:1";
  const pattern = (args.flags.mode || "economy").toLowerCase();
  const outDir = args.flags.out || args.flags.o || loadConfig().outDir;
  const timeoutMs = Number(args.flags.timeout || 900) * 1000;
  const client = clientFromConfig(args.flags);

  await checkQuota(client, { kind: "design", key: "detail", label: "详情图：", force: Boolean(args.flags.force) });

  log(`${dim}上传 ${images.length} 张商品图…`);
  const uploaded = await uploadFiles(client, images);
  const resourceIds = uploaded.map((u) => u.resourceId);

  log(`${dim}AI 正在按场景写详情图文案与提示词…`);
  const plan = await planDetailPrompts(client, {
    resourceIds,
    sellingPoints: selling,
    scenes: requested,
    site,
    country: args.flags.country,
    lang: args.flags.lang,
    size: ratio,
    timeoutMs,
  });
  const prompts = plan.prompts || {};
  const plannedScenes = requested.filter((x) => prompts[x]);
  if (!plannedScenes.length) {
    throw new ApiError("AI 未返回任何场景提示词，无法出图", { code: "NO_PROMPT", payload: plan.raw });
  }
  log(`${dim}已生成 ${plannedScenes.length} 个场景的提示词`);

  log(`${dim}开始出图（${plannedScenes.join(", ")} · ${model.key} · ${sizeName}）…`);
  const out = await generateDetail(client, {
    resourceIds,
    sellingPoints: selling,
    prompts,
    scenes: plannedScenes,
    site,
    country: args.flags.country,
    lang: args.flags.lang,
    model: model.key,
    sizeName,
    ratio,
    pattern,
    conversationId: args.flags.conv || args.flags.conversation,
    timeoutMs,
    onProgress: ({ progress }) => {
      if (progress > 0) log(`${dim}  ${progress}%`);
    },
  });

  const byScene = detailImagesOf(out.raw);
  const total = Object.values(byScene).reduce((n, list) => n + list.length, 0);
  if (!total) throw new ApiError("详情图任务完成但没有返回图片", { code: "GENERATION_FAILED", payload: out.raw });

  const downloaded = [];
  if (!args.flags["no-download"]) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const [scene, imgs] of Object.entries(byScene)) {
      for (const [i, img] of imgs.entries()) {
        const base = `${stamp}-detail-${scene}${imgs.length > 1 ? `-${i + 1}` : ""}`;
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
      sellingPoints: selling,
    });
    return 0;
  }

  say(`${green}✓ 详情图完成 ${total} 张  会话: ${out.conversationId}`);
  for (const d of downloaded) say(`  [${d.scene}] ${d.file} ${dim}(${(d.bytes / 1024).toFixed(0)} KB)`);
  await quotaAfterRun(client, { kind: "design", key: "detail", label: "详情图" });
  return 0;
}

async function cmdTask(args) {
  const ids = args._.slice(1);
  if (!ids.length) throw new UserError("用法：pwish task <task_id> [...]");
  const client = clientFromConfig(args.flags);
  const out = [];
  for (const id of ids) {
    const resolved = await resolveTask(client, id);
    if (!resolved) {
      out.push({ taskId: id, found: false });
      continue;
    }
    const item = resolved.item;
    out.push({
      taskId: id,
      kind: resolved.kind,
      found: true,
      state: item.state ?? item.status,
      progress: item.progress,
      model: item.model_type,
      error: item.error || "",
      images: taskImageUrls(resolved),
      conversationId: item.conversation_id,
    });
  }
  if (args.flags.json) return json(out), 0;
  for (const r of out) {
    if (!r.found) {
      say(`${yellow}${r.taskId} 未找到`);
      continue;
    }
    if (r.kind === "conversation") {
      say(`${r.taskId}  会话 · ${r.images.length} 张图`);
    } else {
      say(`${r.taskId}  state=${r.state} progress=${r.progress}%  ${r.error || ""}`);
    }
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
  const resolved = await resolveTask(client, id);
  const urls = taskImageUrls(resolved);
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
  pwish login                    打开本机登录页（微信扫码 / 账号密码）
  pwish login --no-open          不自动开浏览器，手动访问打印的链接
  pwish login --token 'v2,...'   CI/无浏览器环境直接给 token
  pwish login --paste            从剪贴板读 token
  pwish whoami                   查看当前账号（会员身份 / 算粒）
  pwish quota                    额度总览：模型、设计任务、图片工具
  pwish logout

${cyan}一句话出图（AI 设计师对话式生图）
  pwish gen "<提示词>" [-i 参考图 ...] [-m 模型] [-r 比例] [-s 2K] [--mode economy|stable] [-n 张数] [-o 输出目录]
  例：pwish gen "白底商品图，柔和影棚光" -i ./mug.jpg -m gemini-3 -r 1:1 -s 2K

${cyan}电商套图（商品图 → 多场景成套图）
  pwish suite -i ./product.jpg [--selling "产品名+卖点"] [--site amazon] [--scenes main,core,selling,material,person]
  可选：-m 模型 --size 2K --ratio 1:1 -o 输出目录

${cyan}电商详情图（商品图 → 详情页模块图）
  pwish detail -i ./product.jpg --selling "产品名+卖点" [--scenes poster,highlights,feature,detail]
  场景：poster(海报) highlights(亮点) feature(卖点) detail(细节) lifestyle(生活) scenes(多场景) dimensions(尺寸)
  可选：-m 模型 --size 2K --ratio 1:1 --mode economy -o 输出目录

${cyan}图片工具（一图一任务，直接出图）
  pwish cutout ./photo.jpg                        抠图去背景 → 透明底 PNG
  pwish upscale ./photo.jpg [--type photo|general|text] [--scale 2]   变清晰/放大
  pwish restore ./photo.jpg                       高清修复（模糊、低清、老照片）
  pwish expand ./photo.jpg --to 16:9              图像扩展/扩图（也可 --left 0.2 --top 0.1）
  pwish bg ./product.jpg --prompt "白色大理石台面"  AI 换背景（自动先抠图）
  pwish dewatermark ./photo.jpg                   自动去水印
  pwish erase ./photo.jpg --mask ./mask.png [--strength 3]  去杂物/擦除
  pwish colorize ./bw-photo.jpg                   黑白照片上色
  pwish convert ./photo.png --format jpg          格式转换（jpg/png/webp/bmp/gif）

${cyan}查询与下载
  pwish task <task_id> [...]    查询任务状态
  pwish history [--limit 20]    历史会话
  pwish show <conversation_id>  会话详情
  pwish download <id> [-o dir]  重新下载图片
  pwish queue                   查看任务队列

${cyan}其他
  pwish models                  列出模型/比例/清晰度
  pwish skill --install         安装 agent skill
  全局：--json 机器可读输出   --out/-o 输出目录（默认 out/，可用 PWISH_OUT 覆盖）
        --force 跳过额度预检（账号还有会员权益但 CLI 判为 0 时用）

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
    case "skill":
      return cmdSkill(args);
    case "cutout":
    case "upscale":
    case "bg":
    case "dewatermark":
    case "erase":
    case "restore":
    case "expand":
    case "colorize":
    case "convert":
      return cmdTool(cmd, args);
    case "gen":
    case "draw":
    case "create":
      return cmdGen(args);
    case "suite":
    case "taotu":
      return cmdSuite(args);
    case "detail":
    case "xiangqing":
      return cmdDetail(args);
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
