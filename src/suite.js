import { dimensionFor, SIZE_TO_QUALITY, SUITE_SITES, resolveModel } from "./models.js";
import { pollTask, createConversation, imagesOf } from "./tasks.js";

/**
 * 套图第一步：让 AI 根据商品图 + 卖点，为每个场景写提示词。
 * POST tasks/login/suite/prompt → { data.task_id } → GET tasks/login/suite/prompt/{task_id}
 */
export async function planSuitePrompts(client, { resourceIds, sellingPoints, site = "amazon", country, lang, scenes, size = "1:1" }) {
  const siteInfo = SUITE_SITES[site] || SUITE_SITES.amazon;
  const body = {
    from: "suite-prompt",
    selling_points: sellingPoints,
    site,
    country: country || siteInfo.country,
    lang: lang || siteInfo.lang,
    scene: scenes,
    size,
    source_resource_ids: resourceIds,
  };
  const res = await client.request("tasks/login/suite/prompt", { method: "POST", body, timeout: 90_000 });
  const taskId = res.data?.task_id;
  if (!taskId) throw new Error("AI 写卖点失败：接口未返回 task_id");
  const data = await pollTask(async () => {
    const r = await client.request(`tasks/login/suite/prompt/${taskId}`, { timeout: 60_000 });
    return r.data;
  }, { timeoutMs: 300_000, intervalMs: 2500 });
  return { taskId, prompts: data.prompts || {}, raw: data };
}

/**
 * 套图第二步：按场景批量出图。
 * POST tasks/login/suite → { data.task_id } → GET tasks/login/suite/{task_id}
 */
export async function generateSuite(client, {
  resourceIds,
  sellingPoints,
  prompts = {},
  scenes,
  site = "amazon",
  country,
  lang,
  model = "gemini-3",
  sizeName = "2K",
  ratio = "1:1",
  pattern = "economy",
  conversationId,
  timeoutMs = 900_000,
  onProgress,
}) {
  const siteInfo = SUITE_SITES[site] || SUITE_SITES.amazon;
  const m = resolveModel(model);
  const quality = SIZE_TO_QUALITY[sizeName] || "high";
  const cid = conversationId || (await createConversation(client)).conversation_id;

  const body = {
    from: "design-suite",
    selling_points: sellingPoints,
    filter_keywords: "",
    site,
    country: country || siteInfo.country,
    lang: lang || siteInfo.lang,
    scene: scenes,
    model_type: m.id,
    size: ratio,
    quality,
    pattern,
    source_resource_ids: resourceIds,
    prompts,
    conversation_id: cid,
  };
  if (m.family === "gpt2") {
    body.resolution = quality;
    body.dimension = dimensionFor(ratio === "auto" ? "1:1" : ratio, sizeName);
  }

  const res = await client.request("tasks/login/suite", { method: "POST", body, timeout: 120_000 });
  const taskId = res.data?.task_id;
  if (!taskId) throw new Error(`套图任务创建失败：${JSON.stringify(res).slice(0, 200)}`);

  const data = await pollTask(async () => {
    const r = await client.request(`tasks/login/suite/${taskId}`, { timeout: 60_000 });
    return r.data;
  }, { timeoutMs, intervalMs: 4000, onProgress: (p) => onProgress?.({ ...p, taskId }) });

  return { conversationId: cid, taskId, raw: data };
}

/** 从套图任务结果里抽出 { scene: [images] } */
export function suiteImagesOf(data) {
  const out = {};
  const push = (scene, item) => {
    const imgs = imagesOf(item);
    if (!imgs.length) return;
    const key = scene || "unknown";
    out[key] = [...(out[key] || []), ...imgs];
  };

  // 主流结构：data.items = { main: { answer: [...] }, selling: {...} }
  const items = data?.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    for (const [scene, item] of Object.entries(items)) {
      if (item && (item.answer || item.file)) push(scene, item);
    }
    if (Object.keys(out).length) return out;
  }

  const walk = (node, scene) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, scene);
      return;
    }
    const s = node.scene || node.promptKey || scene;
    if (Array.isArray(node.answer) || node.file || node.url) push(s, node);
    for (const key of ["suiteItems", "answers", "data", "list"]) {
      if (node[key]) walk(node[key], s);
    }
  };
  walk(data, null);

  if (!Object.keys(out).length) {
    const imgs = imagesOf(data);
    if (imgs.length) out.unknown = imgs;
  }
  return out;
}

