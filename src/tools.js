import fs from "node:fs";
import { netFetch } from "./net.js";
import os from "node:os";
import path from "node:path";
import { uploadFile, uploadFiles } from "./upload.js";
import { pollTask, assertSafeUrl } from "./tasks.js";

/**
 * 图片工具类任务：上传资源 → 建任务 → 轮询结果 → 下载。
 * 与 AI 设计师的对话式生图不同，这些接口是「一图一任务」的流水线，
 * 建任务接口返回 { task_id }，查询接口返回 { state, progress, image }。
 */

const PREFIX = {
  cutout: "pub/tasks/input/image_cutout",
  general: "pub/tasks/input/llm_chats",
};

/** 建任务并返回任务 id；接口未给 task_id 视为失败。 */
async function create(client, endpoint, body, label) {
  const res = await client.request(endpoint, { method: "POST", body, timeout: 90_000 });
  const taskId = res.data?.task_id || res.data?.id;
  if (!taskId) {
    throw new Error(`${label}任务创建失败：${JSON.stringify(res.data).slice(0, 200)}`);
  }
  return taskId;
}

/** 轮询查询接口，直到 progress 100。 */
function poll(client, endpoint, taskId, timeoutMs, query) {
  return pollTask(() => client.request(`${endpoint}/${taskId}`, { query }).then((r) => r.data), {
    timeoutMs,
    intervalMs: 2000,
  });
}

async function run(client, { file, prefix = PREFIX.general, endpoint, body, timeoutMs, label }) {
  const { resourceId } = await uploadFile(client, file, prefix);
  const taskId = await create(client, endpoint, body(resourceId), label);
  const data = await poll(client, endpoint, taskId, timeoutMs);
  return { taskId, data, resourceId };
}

/** 抠图：输出透明底 PNG。 */
export function removeBackground(client, { file, timeoutMs = 300_000 } = {}) {
  return run(client, {
    file,
    prefix: PREFIX.cutout,
    endpoint: "tasks/login/segmentation",
    body: (source) => ({
      source_resource_id: source,
      output_type: 1,
      format: "png",
      type: 0,
      bg_color: "",
    }),
    timeoutMs,
    label: "抠图",
  });
}

/** 变清晰 / 放大。type: 0=照片, 1=通用, 2=文字。 */
export function upscale(client, { file, type = 1, scaleFactor = 2, timeoutMs = 300_000 } = {}) {
  return run(client, {
    file,
    endpoint: "tasks/login/scale",
    body: (source) => ({
      source_resource_id: source,
      resource_id: source,
      type,
      scale_factor: scaleFactor,
      website: "zh",
    }),
    timeoutMs,
    label: "变清晰",
  });
}

const TARGET_ASPECT = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16, "3:2": 3 / 2, "2:3": 2 / 3 };

/**
 * 按目标画幅算四边外扩比例（0-1，相对各自边长）。
 * 比原图宽就往左右补，比原图高就往上下补，已是目标比例则全为 0。
 */
export function expansionForTarget({ width, height, to }) {
  const target = TARGET_ASPECT[to];
  if (!target) throw new Error(`不支持的目标画幅：${to}（可用：${Object.keys(TARGET_ASPECT).join(" / ")}）`);
  const edges = { left: 0, right: 0, top: 0, bottom: 0 };
  if (!width || !height) return edges;
  const current = width / height;
  if (target > current) {
    const grow = (target / current - 1) / 2;
    edges.left = grow;
    edges.right = grow;
  } else if (target < current) {
    const grow = (current / target - 1) / 2;
    edges.top = grow;
    edges.bottom = grow;
  }
  return edges;
}

/**
 * 图像扩展（扩图）：按比例向四边外扩，或用 `to` 目标画幅自动计算外扩量。
 * 四边取值 0-1，表示相对原图各边长的外扩比例。
 */
export async function expandImage(client, { file, to, left, right, top, bottom, timeoutMs = 300_000 } = {}) {
  const up = await uploadFile(client, file, PREFIX.general);
  const edges = { left: Number(left) || 0, right: Number(right) || 0, top: Number(top) || 0, bottom: Number(bottom) || 0 };
  if (to) {
    const { width, height } = up;
    if (!width || !height) throw new Error("无法读取图片尺寸，改用 --left/--right/--top/--bottom 指定外扩比例");
    Object.assign(edges, expansionForTarget({ width, height, to: String(to) }));
  }
  if (!edges.left && !edges.right && !edges.top && !edges.bottom) {
    throw new Error("至少需要一边外扩：用 --to 16:9 或 --left 0.25 之类的比例");
  }

  const body = {
    source_resource_id: up.resourceId,
    image_count: 1,
    ...edges,
    prompt: "",
    negative_prompt: "",
    size: "",
    from: "",
    conversation_id: "",
    mask_resource_id: "",
    resource_id: "",
    provider: 2,
    horizontal_expansion_ratio: 1,
    vertical_expansion_ratio: 1,
  };
  const taskId = await create(client, "tasks/login/self-image-expand", body, "扩图");
  const data = await poll(client, "tasks/login/self-image-expand", taskId, timeoutMs);
  return { taskId, data, resourceId: up.resourceId };
}

/** 图片翻译语言码（站点码表）。注意：服务端不支持 source=auto，CLI 会本地拒绝。 */
const TRANSLATE_LANGS = ["auto", "CHS", "CHT", "ENG", "JPN", "KOR", "FRA", "DEU", "ESP", "POR", "PTB", "ROM", "RUS", "VIN", "ARA", "THA"];

/** 图片翻译：上传 → 建任务 → 轮询，结果在 data.images[].image。 */
export async function translateImage(client, { file, from = "CHS", to = "ENG", timeoutMs = 600_000 } = {}) {
  const norm = (v) => {
    const upper = String(v).toUpperCase();
    return upper === "AUTO" ? "auto" : upper;
  };
  const source = norm(from);
  const target = norm(to);
  for (const [value, label] of [[source, "--from"], [target, "--to"]]) {
    if (!TRANSLATE_LANGS.includes(value)) {
      throw new Error(`不支持的${label}语言：${value}（可用：${TRANSLATE_LANGS.join(" / ")}）`);
    }
  }
  // 服务端对 auto 会直接返回 task failed（实测），本地拦掉，别白跑一次
  if (source === "auto") {
    throw new Error("服务端不支持自动识别源语言，请按图片实际语种传 --from（如 CHS / ENG）");
  }
  if (source === target) throw new Error("源语言与目标语言相同，翻译没有意义");

  const up = await uploadFile(client, file, "pub/tasks/input/image_translate");
  const body = {
    img_trans_key: "aliyun",
    source_language: source,
    target_language: target,
    task_type: 349,
    quality: "2k",
    source_resource_ids: [up.resourceId],
  };
  const taskId = await create(client, "tasks/login/external/image-translate", body, "图片翻译");
  const data = await poll(client, "tasks/login/external/image-translate", taskId, timeoutMs);
  return { taskId, data, resourceId: up.resourceId };
}

/**
 * 商品还原 / 白底后处理（站点「独立套图」里的 postprocess）。
 *
 * 服务端要求**正好 2 张**源图（`product-restore requires exactly 2 source images`），
 * 走的是 gem-image-edit 而不是普通工具接口，所以参数里要带 provider_model 与 aspect_ratio。
 */
export async function restoreProduct(client, { images, size = "1:1", quality = "high", timeoutMs = 600_000 } = {}) {
  const list = [].concat(images || []).filter(Boolean);
  if (list.length !== 2) {
    throw new Error(`商品还原需要正好 2 张图（服务端限制），当前给了 ${list.length} 张`);
  }
  const uploaded = await uploadFiles(client, list);
  const body = {
    source_resource_ids: uploaded.map((u) => u.resourceId),
    title: "商品还原",
    template_type: 1,
    size,
    quality,
    resolution: quality,
    aspect_ratio: size,
    from: "product-restore",
    provider_model: 72,
    product_id: 482,
    language: "zh",
    website_language: "zh",
    model_type: 72,
    pattern: "economy",
  };
  const taskId = await create(client, "tasks/login/external/gem-image-edit", body, "商品还原");
  const data = await poll(client, "tasks/login/external/gem-image-edit", taskId, timeoutMs);
  return { taskId, data, resourceIds: uploaded.map((u) => u.resourceId) };
}

/** 高清修复（老照片 / 模糊低清图的超分修复）。 */
export function restorePhoto(client, { file, type = 0, timeoutMs = 300_000 } = {}) {
  return run(client, {
    file,
    endpoint: "tasks/login/scale-pro",
    body: (source) => ({ source_resource_id: source, type }),
    timeoutMs,
    label: "高清修复",
  });
}

/**
 * AI 换背景：先抠出透明底，再把透明底交给背景生成接口，
 * 一次返回多张候选图（image_1…image_4）。
 */
export async function changeBackground(client, { file, prompt = "", timeoutMs = 600_000 } = {}) {
  const cut = await removeBackground(client, { file, timeoutMs });
  const cutUrl = resultUrls(cut.data)[0];
  if (!cutUrl) throw new Error("抠图未返回透明底图片，无法换背景");

  const tmp = path.join(os.tmpdir(), `pwish-cut-${process.pid}-${Date.now()}.png`);
  try {
    const res = await netFetch(assertSafeUrl(cutUrl), { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`下载抠图结果失败 HTTP ${res.status}`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const { resourceId } = await uploadFile(client, tmp, PREFIX.general);
    const body = { source_resource_id: resourceId };
    if (prompt) body.prompt = prompt;
    const taskId = await create(client, "tasks/login/background", body, "换背景");
    const data = await poll(client, "tasks/login/background", taskId, timeoutMs);
    return { taskId, data, resourceId, cutoutTaskId: cut.taskId };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** 去水印（自动识别水印区域）。 */
export function removeWatermark(client, { file, timeoutMs = 300_000 } = {}) {
  return run(client, {
    file,
    endpoint: "tasks/login/auto-watermark-image",
    body: (source) => ({ source_resource_id: source, other_task_id: "", task_type: 302 }),
    timeoutMs,
    label: "去水印",
  });
}

/** 去杂物 / 擦除：mask 是标注要擦除区域的蒙版图。 */
export async function removeObject(client, { file, mask, strength = 3, timeoutMs = 300_000 } = {}) {
  const source = await uploadFile(client, file, PREFIX.general);
  const masked = await uploadFile(client, mask, PREFIX.general);
  const taskId = await create(
    client,
    "tasks/login/object-refine",
    {
      source_resource_id: source.resourceId,
      file_name: path.basename(file),
      mask_resource_id: masked.resourceId,
      engine: "aliyun",
      source_lang: "auto",
      target_lang: "en",
      line_strength: 60,
      retouch_strength: Number(strength) * 10,
      refine_type: 1,
      background: "",
    },
    "去杂物",
  );
  const data = await poll(client, "tasks/login/object-refine", taskId, timeoutMs);
  return { taskId, data, resourceId: source.resourceId };
}

/**
 * 服装图：幽灵模特（服装 3D 图）/ 平铺图。
 *
 * 两者都是 gem-image-edit 的 `from` 变体，固定 model_type=195（GPT Image 2）：
 *  - ghost-model：quality=default，把衣服从模特身上「脱」成隐形人台效果
 *  - flat-lay：quality=high，铺平成俯拍平铺图
 */
export function garmentBody({ mode = "mannequin", ratio = "1:1", resourceId }) {
  const isFlatLay = mode === "flatlay";
  return {
    source_resource_ids: [resourceId],
    from: isFlatLay ? "flat-lay" : "ghost-model",
    model_type: 195,
    provider_model: 195,
    quality: isFlatLay ? "high" : "default",
    aspect_ratio: ratio,
    product_id: 482,
    language: "zh",
    website_language: "zh",
    template_type: 0,
  };
}

export async function garmentModel(client, { file, mode = "mannequin", ratio = "1:1", timeoutMs = 600_000 } = {}) {
  const isFlatLay = mode === "flatlay";
  const up = await uploadFile(client, file);
  const body = garmentBody({ mode, ratio, resourceId: up.resourceId });
  const taskId = await create(client, "tasks/login/external/gem-image-edit", body, isFlatLay ? "平铺图" : "幽灵模特");
  const data = await poll(client, "tasks/login/external/gem-image-edit", taskId, timeoutMs);
  return { taskId, data, resourceId: up.resourceId };
}

/**
 * 去褶皱（服装 / 布料褶皱消除）。
 * alpha 是 0 以上的数字（传布尔会被服务端拒绝：`must be equal or greater than 0`）。
 */
export function removeWrinkle(client, { file, alpha = 0, timeoutMs = 300_000 } = {}) {
  return run(client, {
    file,
    endpoint: "tasks/login/external/remove-wrinkle",
    body: (source) => ({ source_resource_id: source, alpha: Number(alpha) || 0 }),
    timeoutMs,
    label: "去褶皱",
  });
}

/** 黑白照片上色。 */
export function colorize(client, { file, timeoutMs = 300_000 } = {}) {
  return run(client, {
    file,
    endpoint: "tasks/login/colorization",
    body: (source) => ({ source_resource_id: source }),
    timeoutMs,
    label: "上色",
  });
}

const CONVERT_FORMATS = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", bmp: "bmp", gif: "gif" };

/** 图片格式转换。 */
export async function convertFormat(client, { file, format = "png", timeoutMs = 180_000 } = {}) {
  const target = CONVERT_FORMATS[String(format).toLowerCase()];
  if (!target) throw new Error(`不支持的格式：${format}（可用：${Object.keys(CONVERT_FORMATS).join(" / ")}）`);
  const { resourceId } = await uploadFile(client, file, PREFIX.general);
  const res = await client.request("tasks/image-conversion", {
    method: "POST",
    body: { resource_id: resourceId, language: "zh", product_id: 482, format: target },
    timeout: 60_000,
  });
  const taskId = res.data?.task_id;
  if (!taskId) throw new Error(`格式转换任务创建失败：${JSON.stringify(res.data).slice(0, 200)}`);
  const originalFormat = res.data?.original_format || path.extname(file).replace(".", "") || "png";
  const data = await poll(client, "tasks/image-conversion", taskId, timeoutMs, {
    original_format: originalFormat,
  });
  return { taskId, data, resourceId, format: target };
}

const PRIMARY_KEYS = /^(image|image_?\d+|file|url|image_url|result_url|output)$/;
/** 预览图、蒙版、原图占位、加速地址都不算正式结果。 */
const IGNORE_KEYS = /^(small_image|mask|mask_data|thumbnail|cover|accelerate_|ori_image)/;

/** 从任意任务结果里提取图片 URL（优先正式结果，忽略预览图与蒙版）。 */
export function resultUrls(data) {
  const primary = [];
  const others = [];
  const seen = new Set();
  const visit = (value, key, depth) => {
    if (value == null || depth > 5) return;
    if (key && IGNORE_KEYS.test(key)) return;
    if (typeof value === "string") {
      if (!/^https?:\/\//.test(value) || seen.has(value)) return;
      seen.add(value);
      if (!key || PRIMARY_KEYS.test(key)) primary.push(value);
      else others.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k, depth + 1);
    }
  };
  visit(data, "", 0);
  return primary.length ? primary : others;
}
