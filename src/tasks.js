import fs from "node:fs";
import { netFetch } from "./net.js";
import { safeName } from "./filename.js";
import { assertImageBytes } from "./imagebytes.js";
import path from "node:path";
import { ApiError } from "./api.js";

/** 轮询直到任务完成；返回后端最终 data。 */
/**
 * 轮询任务直到完成。
 *
 * 生成任务动辄几分钟，期间偶发的网络抖动不该让整个任务作废：
 * 查询抛错会先重试，只有连续 `maxConsecutiveErrors` 次失败才放弃。
 */
export async function pollTask(
  fetcher,
  { timeoutMs = 300_000, intervalMs = 3000, onProgress, maxConsecutiveErrors = 5 } = {},
) {
  const started = Date.now();
  let last = null;
  let missCount = 0;
  let errorCount = 0;
  while (Date.now() - started < timeoutMs) {
    let data;
    try {
      data = await fetcher();
      errorCount = 0;
    } catch (err) {
      errorCount += 1;
      if (errorCount >= maxConsecutiveErrors) throw err;
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    if (!data) {
      missCount += 1;
      if (missCount > 10) throw new Error("任务查询连续失败，已放弃");
    } else {
      missCount = 0;
      last = data;
      const state = Number(data.state ?? data.status ?? 0);
      const progress = Number(data.progress ?? 0);
      onProgress?.({ state, progress, data, elapsedMs: Date.now() - started });
      // 失败优先于完成：有的任务会同时回 state<0 与 progress=100
      if (state < 0) {
        throw new Error(`任务失败（state=${state}）${data.error ? `：${data.error}` : ""}`);
      }
      if (state === 1 || progress === 100) return data;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (last && (Number(last.state) === 1 || Number(last.progress) === 100)) return last;
  throw new Error(`等待超时（${Math.round(timeoutMs / 1000)}s）。任务可能仍在服务端排队，稍后用 \`pwish task <task_id>\` 查询。`);
}

export async function createConversation(client) {
  const res = await client.request("image/conversations", { method: "POST", body: {} });
  return res.data;
}

export async function createImageMessage(client, payload) {
  const res = await client.request("tasks/login/image-messages", { method: "POST", body: payload, timeout: 90_000 });
  const data = res.data || {};
  const taskId = data.task_id || data.message_id;
  if (!taskId) throw new Error("创建任务失败：接口未返回 task_id");
  return { ...data, task_id: taskId, message_id: data.message_id || taskId };
}

/** 批量查询任务：返回 { [task_id]: data } */
async function batchTasks(client, taskIds) {
  if (!taskIds.length) return {};
  const res = await client.request("tasks/login/image-messages/batch", {
    query: { task_ids: taskIds.join(",") },
    timeout: 60_000,
  });
  const items = res.data?.items;
  if (items && typeof items === "object") return items;
  const list = Array.isArray(res.data) ? res.data : [];
  const map = {};
  for (const item of list) {
    const id = item.task_id || item.message_id;
    if (id) map[id] = item;
  }
  return map;
}

export async function waitForTasks(client, taskIds, { timeoutMs = 300_000, intervalMs = 3000, onProgress } = {}) {
  const done = new Map();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const map = await batchTasks(client, taskIds.filter((id) => !done.has(id)));
    for (const id of taskIds) {
      const item = map[id];
      if (!item || done.has(id)) continue;
      const state = Number(item.state ?? item.status ?? 0);
      const progress = Number(item.progress ?? 0);
      const hasAnswer = Array.isArray(item.answer) && item.answer.length > 0;
      onProgress?.({ taskId: id, state, progress, item });
      // 失败优先于完成：和 pollTask 保持一致，避免 state<0 + progress=100 被当成成功
      if (state < 0) done.set(id, { ...item, failed: true });
      else if (state === 1 || (progress === 100 && hasAnswer)) done.set(id, item);
    }
    if (done.size === taskIds.length) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  for (const id of taskIds) if (!done.has(id)) done.set(id, { task_id: id, failed: true, timeout: true });
  return done;
}

export function imagesOf(item) {
  const answers = item?.answer;
  if (!Array.isArray(answers)) return [];
  return answers
    .flatMap((a) => (Array.isArray(a) ? a : [a]))
    .map((a) => ({
      url: a?.file || a?.url,
      thumb: a?.thumbnail,
      fileId: a?.file_id,
      isVideo: Boolean(a?.video || a?.is_video),
    }))
    .filter((a) => a.url);
}

function extFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname;
    const ext = path.extname(p).toLowerCase();
    if (ext && ext.length <= 6) return ext;
  } catch {
    /* ignore */
  }
  return fallback;
}

/** 只允许从这些域名下载/拉取结果，避免任务响应里的地址把请求带到任意主机。 */
const ALLOWED_HOSTS = [/(^|\.)aliyuncs\.com$/i, /(^|\.)aoscdn\.com$/i, /(^|\.)picwish\.cn$/i];

/**
 * 原子落盘：先写同目录临时文件再 rename。
 * 中途崩溃/磁盘满时不会留下半截文件被后续误当成完整图片。
 */
export function writeFileAtomic(file, buf) {
  const tmp = `${file}.${process.pid}.part`;
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function assertSafeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    throw new Error(`结果地址不合法：${String(raw).slice(0, 120)}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`只允许 https 结果地址：${parsed.protocol}`);
  if (!ALLOWED_HOSTS.some((re) => re.test(parsed.hostname))) {
    throw new Error(`结果地址域名不在白名单：${parsed.hostname}`);
  }
  return parsed.toString();
}

export async function downloadImage(url, outDir, basename, fallbackExt = ".png", { timeoutMs = 120_000 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const safeUrl = assertSafeUrl(url);
  const ext = extFromUrl(safeUrl, fallbackExt);
  // basename 可能含服务端给的 scene/task 片段，落盘前统一消毒，避免路径穿越
  const file = path.join(outDir, `${safeName(basename)}${ext}`);
  let res;
  try {
    res = await netFetch(safeUrl, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(err.name === "TimeoutError" ? `下载超时（${Math.round(timeoutMs / 1000)}s）` : `下载失败：${err.message}`);
  }
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${safeUrl.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // HTTP 200 + XML/JSON 错误体（签名过期等）不能当图片落盘
  assertImageBytes(buf, safeUrl);
  writeFileAtomic(file, buf);
  return { file, bytes: buf.length };
}

/** 套图 / 详情图任务（tasks/login/suite/{id}），返回含 items 的原始 data。 */
async function getSuiteTask(client, taskId) {
  const res = await client.request(`tasks/login/suite/${taskId}`, { timeout: 60_000 });
  return res.data;
}

/** 任务详情解析：先试对话式任务，再试套图/详情图，最后试会话。 */
export async function resolveTask(client, id) {
  try {
    const map = await batchTasks(client, [id]);
    const item = map[id];
    // 批量接口对未知 id 会返回 state=15021 的占位对象，用 message_id 判断是否真实存在
    if (item && (item.message_id || item.task_id)) return { kind: "image", item };
  } catch {
    /* 不是对话式任务 id，继续尝试 */
  }
  try {
    const item = await getSuiteTask(client, id);
    if (item && (item.items || item.answer)) return { kind: "suite", item };
  } catch {
    /* 不是套图/详情图任务 id */
  }
  try {
    const conv = await getConversation(client, id);
    if (conv) return { kind: "conversation", item: conv };
  } catch {
    /* 也不是会话 id */
  }
  return null;
}

/** 从任意一种任务结果里取出图片 URL（套图/详情图按场景平铺）。 */
export function taskImageUrls(resolved) {
  if (!resolved) return [];
  const { kind, item } = resolved;
  if (kind === "conversation") {
    return (item.items || []).flatMap((it) => imagesOf(it).map((i) => i.url));
  }
  if (kind === "suite") {
    // 套图/详情图：items 按场景分组，answer 是兜底的平铺结果
    const items = item.items;
    if (items && typeof items === "object" && !Array.isArray(items)) {
      const urls = Object.values(items).flatMap((it) => imagesOf(it).map((i) => i.url));
      if (urls.length) return urls;
    }
    return imagesOf(item).map((i) => i.url);
  }
  return imagesOf(item).map((i) => i.url);
}

export async function listConversations(client, { page = 1, perPage = 20 } = {}) {
  const res = await client.request("image/conversations", { query: { page, per_page: perPage } });
  return res.data;
}

export async function getConversation(client, conversationId, { page = 1, perPage = 50 } = {}) {
  const res = await client.request(`image/conversations/${conversationId}`, { query: { page, per_page: perPage } });
  return res.data;
}

export async function queueStatus(client) {
  const res = await client.request("image/conversations/task-queue");
  return res.data;
}

/**
 * 校验 token 是否真实有效。
 * 注意：vips/all-free-counts 对无效 token 也会返回 200，不能用来判断登录态，
 * 因此这里用会返回 401 的会话列表接口做探针。
 */
export async function verifyToken(client) {
  const res = await client.request("image/conversations", { query: { page: 1, per_page: 1 } });
  if (res?.status && res.status !== 200) {
    throw new ApiError("token 无效或已过期，请重新登录", { code: "UNAUTHORIZED", payload: res });
  }
  return true;
}

export async function freeCounts(client, cfg) {
  // 站点按 website 返回不同的计数字段；默认 zh（product_id 482 就是中文站），
  // 不能因为调用方没传 cfg 就退化成 en。
  const website = cfg?.language === "en" ? "en" : "zh";
  const res = await client.request("vips/all-free-counts", { query: { website } });
  return res.data;
}
