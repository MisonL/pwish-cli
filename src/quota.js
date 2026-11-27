/**
 * 会员 / 算粒 / 免费额度。
 *
 * 数据来自 `GET vips/all-free-counts`：一个扁平的大对象，字段名与站点功能一一对应。
 * 这里只映射能确认语义的字段，其余一律不猜（显示为「—」）。
 */

/** 电商模型 → 免费次数字段（第一个有值的生效）。 */
const MODEL_FIELDS = {
  "gemini-3": ["llm_chat_num_gm30", "llm_chat_num_gem30"],
  "nano-banana-pro": ["llm_chat_num_banana21", "llm_chat_num_gem31"],
  "nano-banana-2-lite": ["llm_chat_num_gem31lite"],
  "gpt-image-2": ["llm_chat_num_gpt2"],
  "gpt-image-2-flare": ["llm_chat_num_gpt2"],
  "gpt-image-1.5": ["llm_chat_num_gpt2"],
  "gpt-image-1": ["llm_chat_num_gpt2"],
  "gemini-2.5": ["llm_chat_num_gm25"],
  "jimeng-4.5": ["llm_chat_num_jm40"],
  "jimeng-4.0": ["llm_chat_num_jm40"],
  "jimeng-5-flash": ["llm_chat_num_jm50fla"],
  "seedream-5-pro": ["llm_chat_num_general"],
  "seedream-5-flash": ["llm_chat_num_general"],
  "seedream-5.5": ["llm_chat_num_general"],
  flux: ["llm_chat_num_general"],
  google: ["llm_chat_num_general"],
};

/** 设计任务 → 免费次数字段。 */
const DESIGN_FIELDS = {
  suite: ["llm_chat_suite"],
  detail: ["llm_chat_detail"],
  edit: ["image_edit_free_num"],
  text2img: ["llm_chat_num_general", "text_to_image_free_num"],
};

/**
 * 图片工具 → 剩余次数字段。
 *
 * 只取「还能用几次」这一列：站点另有一组 `*_used_free_num`，但实测对抠图、格式转换
 * 连续成功调用后并不变化（翻译、扩图则会实时递减），语义无法确认，所以不展示、不参与判断。
 */
const TOOL_FIELDS = {
  cutout: { remain: "segmentation_login_num" },
  upscale: { remain: "scale_login_num" },
  restore: { remain: "scale_pro_gift" },
  expand: { remain: "image_expand_num" },
  bg: { remain: "background_free_num" },
  dewatermark: { remain: "watermark_image_free_num" },
  erase: { remain: "object_refine_num" },
  colorize: { remain: "colorization_general_gift" },
  translate: { remain: "image_translate_num" },
  convert: { remain: "document_conversion_num" },
};

/** 多个候选字段取最大值：任一口径还有次数就不该被判成 0。 */
function maxValue(data, fields) {
  let best = { field: null, value: undefined };
  for (const field of fields) {
    const value = data[field];
    if (typeof value !== "number") continue;
    if (best.value === undefined || value > best.value) best = { field, value };
  }
  return best;
}

function toolRemain(data, spec) {
  const remain = data[spec.remain];
  if (typeof remain !== "number") return { remain: undefined };
  return { remain };
}

/** 把原始 all-free-counts 响应整理成 CLI 用的结构。 */
export function summarizeQuota(data = {}) {
  const vipDetail = data.vip_detail || {};
  const vipQuota = data.local_vip_quota || {};
  const models = {};
  for (const [key, fields] of Object.entries(MODEL_FIELDS)) {
    const { value } = maxValue(data, fields);
    if (value !== undefined) models[key] = value;
  }
  const designer = {};
  for (const [key, fields] of Object.entries(DESIGN_FIELDS)) {
    const { value } = maxValue(data, fields);
    if (value !== undefined) designer[key] = value;
  }
  const tools = {};
  for (const [key, spec] of Object.entries(TOOL_FIELDS)) {
    tools[key] = toolRemain(data, spec);
  }
  return {
    membership: {
      isVip: Boolean(data.vip) || Boolean(vipQuota.is_vip),
      licenseType: vipDetail.license_type || (data.vip ? "vip" : "free"),
      expiredAt: vipDetail.expired_at && vipDetail.expired_at > 1 ? vipDetail.expired_at : null,
      remainedSeconds: vipDetail.remained_seconds || 0,
    },
    credits: {
      free: data.free_point || 0,
      allFree: data.all_free_point || 0,
      vipGeminiRemain: vipQuota.gemini_remain || 0,
      vipWatermarkRemain: vipQuota.watermark_image_remain || 0,
    },
    models,
    designer,
    tools,
    raw: data,
  };
}

/** 某个模型还能免费出几张（未知返回 undefined）。 */
export function modelRemain(quota, modelKey) {
  return quota.models[modelKey];
}

/** 某个工具还能免费用几次（未知返回 undefined）。 */
export function toolRemainOf(quota, toolKey) {
  return quota.tools[toolKey]?.remain;
}

/** 是否有可用于生成的算粒（免费算粒或会员算粒）。 */
export function hasCredits(quota) {
  return quota.credits.free > 0 || quota.credits.allFree > 0 || quota.credits.vipGeminiRemain > 0;
}

/**
 * 生成前的额度预检。
 * @returns {{level:"ok"|"warn"|"block", message:string, remain?:number}}
 */
export function preflight(quota, { kind, modelKey }) {
  const remain =
    kind === "model" ? modelRemain(quota, modelKey) : kind === "tool" ? toolRemainOf(quota, modelKey) : quota.designer[modelKey];

  if (remain === undefined) return { level: "ok", message: "额度未知，以接口返回为准" };
  if (remain > 0) return { level: "ok", message: "", remain };

  if (kind === "model") {
    const alternatives = Object.entries(quota.models)
      .filter(([key, value]) => key !== modelKey && value > 0)
      .sort((a, b) => b[1] - a[1]);
    const hint = alternatives.length
      ? `可换用还有额度的模型：${alternatives.map(([key, value]) => `${key}(${value})`).join("、")}`
      : "所有生图模型的免费次数都用完了";
    const creditHint = hasCredits(quota) ? "；账号还有算粒，可直接付费生成" : "；账号算粒为 0，需升级会员或充值";
    return { level: "block", message: `免费次数已用完，${hint}${creditHint}`, remain: 0 };
  }

  const extra = hasCredits(quota) || quota.membership.isVip ? "；账号还有会员权益" : "";
  return { level: "block", message: `免费次数已用完（是否回补以站点为准）${extra}`, remain: 0 };
}
