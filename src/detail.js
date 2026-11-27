import { dimensionFor, SIZE_TO_QUALITY, SUITE_SITES, resolveModel } from "./models.js";
import { pollTask, createConversation } from "./tasks.js";
import { suiteImagesOf } from "./suite.js";

/**
 * 电商详情图（长图套装）：一张商品图 → 多张详情页模块图。
 *
 * 和套图共用 `tasks/login/suite` 接口，靠 `from` 区分：
 * - 写提示词：`from: "detail-custom-prompt"` → `tasks/login/suite/prompt`
 * - 出图：`from: "design-detail"` → `tasks/login/suite`
 *
 * 详情图的场景由服务端推荐接口给出：poster / highlights / feature /
 * detail / lifestyle / scenes / dimensions。
 */
export const DETAIL_SCENES = {
  poster: "海报主图",
  highlights: "亮点合集",
  feature: "卖点图",
  detail: "细节图",
  lifestyle: "场景生活图",
  scenes: "多场景图",
  dimensions: "尺寸标注图",
};

/** 让 AI 按场景写详情图提示词。 */
export async function planDetailPrompts(
  client,
  { resourceIds, sellingPoints, scenes, site = "amazon", country, lang, size = "1:1", timeoutMs = 300_000 },
) {
  const siteInfo = SUITE_SITES[site] || SUITE_SITES.amazon;
  const body = {
    from: "detail-custom-prompt",
    selling_points: sellingPoints,
    filter_keywords: "",
    site,
    country: country || siteInfo.country,
    lang: lang || siteInfo.lang,
    scene: scenes,
    size,
    source_resource_ids: resourceIds,
  };
  const res = await client.request("tasks/login/suite/prompt", { method: "POST", body, timeout: 90_000 });
  const taskId = res.data?.task_id;
  if (!taskId) throw new Error(`详情图提示词任务创建失败：${JSON.stringify(res.data).slice(0, 200)}`);
  const data = await pollTask(async () => (await client.request(`tasks/login/suite/prompt/${taskId}`, { timeout: 60_000 })).data,
    { timeoutMs, intervalMs: 2500 },
  );
  return { taskId, prompts: data.prompts || {}, raw: data };
}

/** 用提示词出详情图。 */
export async function generateDetail(
  client,
  {
    resourceIds,
    sellingPoints,
    prompts,
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
  },
) {
  const siteInfo = SUITE_SITES[site] || SUITE_SITES.amazon;
  const m = resolveModel(model);
  const quality = SIZE_TO_QUALITY[sizeName] || "high";
  const cid = conversationId || (await createConversation(client)).conversation_id;

  const body = {
    from: "design-detail",
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
    select_type: "recommend",
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
  if (!taskId) throw new Error(`详情图任务创建失败：${JSON.stringify(res.data).slice(0, 200)}`);

  const data = await pollTask(async () => (await client.request(`tasks/login/suite/${taskId}`, { timeout: 60_000 })).data,
    { timeoutMs, intervalMs: 4000, onProgress: (p) => onProgress?.({ ...p, taskId }) },
  );
  return { conversationId: cid, taskId, raw: data };
}

/** 从详情图结果里抽 { scene: [images] }（结构同套图 items）。 */
export function detailImagesOf(data) {
  return suiteImagesOf(data);
}

