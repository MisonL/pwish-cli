import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadFile } from "./upload.js";
import { pollTask } from "./tasks.js";

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
  return pollTask(client, () => client.request(`${endpoint}/${taskId}`, { query }).then((r) => r.data), {
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
    const res = await fetch(cutUrl);
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

const PRIMARY_KEYS = /^(image|image_\d+|file|url|image_url|result_url|output)$/;
/** 预览图、蒙版、加速地址都不算正式结果。 */
const IGNORE_KEYS = /^(small_image|mask|mask_data|thumbnail|cover|accelerate_)/;

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
