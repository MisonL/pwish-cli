import fs from "node:fs";
import path from "node:path";

/** 轮询直到任务完成；返回后端最终 data。 */
export async function pollTask(client, fetcher, { timeoutMs = 300_000, intervalMs = 3000, onProgress } = {}) {
  const started = Date.now();
  let last = null;
  let missCount = 0;
  while (Date.now() - started < timeoutMs) {
    const data = await fetcher();
    if (!data) {
      missCount += 1;
      if (missCount > 10) throw new Error("任务查询连续失败，已放弃");
    } else {
      missCount = 0;
      last = data;
      const state = Number(data.state ?? data.status ?? 0);
      const progress = Number(data.progress ?? 0);
      onProgress?.({ state, progress, data });
      if (state === 1 || progress === 100) return data;
      if (state < 0) {
        throw new Error(`任务失败（state=${state}）${data.error ? `：${data.error}` : ""}`);
      }
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
export async function batchTasks(client, taskIds) {
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
      if (state === 1 || (progress === 100 && hasAnswer)) done.set(id, item);
      else if (state < 0) done.set(id, { ...item, failed: true });
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

export async function downloadImage(url, outDir, basename, fallbackExt = ".png") {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = extFromUrl(url, fallbackExt);
  const file = path.join(outDir, `${basename}${ext}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${url.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return { file, bytes: buf.length };
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

export async function freeCounts(client, cfg) {
  const res = await client.request("vips/all-free-counts", {
    query: { website: cfg?.language === "zh" ? "zh" : "en" },
  });
  return res.data;
}
