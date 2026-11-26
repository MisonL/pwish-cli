/**
 * 模型表来自站点前端 modelTypes 模块（picwish 前端 modelTypes.32ILtW8x.js）。
 * payload 说明：
 *  - pattern  : economy | stable（经济 / 稳定模式）
 *  - quality  : GPT 系列取 high/default；GPT_IMAGE_2 系取 standard/high/super（由 1K/2K/2K+ 映射）
 *  - size     : 比例，如 "1:1"、"9:16"；"auto" 表示交给服务端按参考图判断
 *  - dimension: 仅 GPT_IMAGE_2 系需要，形如 "2048x2048"
 */
export const MODELS = {
  "gemini-3": { id: 6, family: "nano", label: "电商模型 3.0（Gemini 3 / Nano Banana Pro）", credits: "10-20/张" },
  "nano-banana-pro": { id: 72, family: "nano", label: "电商模型 2.0（Nano Banana 2 / Gemini 3.1）", credits: "10-20/张" },
  "nano-banana-2-lite": { id: 61, family: "nano", label: "电商模型 1.0（Nano Banana 2 Lite）", credits: "5-10/张" },
  "gpt-image-2": { id: 195, family: "gpt2", label: "GPT Image 2（补贴通用模型）", credits: "3-5/张" },
  "gpt-image-2-flare": { id: 89, family: "gpt2", label: "GPT Image 2 Flare", credits: "3-5/张" },
  "gpt-image-1.5": { id: 190, family: "gpt1", label: "GPT Image 1.5", credits: "5-15/张" },
  "gpt-image-1": { id: 83, family: "gpt1", label: "GPT Image 1", credits: "15-60/张" },
  "gemini-2.5": { id: 154, family: "nano", label: "Gemini 2.5 Flash Image", credits: "5-10/张" },
  "seedream-5-pro": { id: 78, family: "seedream", label: "Seedream 5 Pro", credits: "按张计费" },
  "seedream-5-flash": { id: 79, family: "seedream", label: "Seedream 5 Flash", credits: "按张计费" },
  "seedream-5.5": { id: 94, family: "seedream", label: "Seedream 5.5", credits: "按张计费" },
  "jimeng-4.5": { id: 41, family: "seedream", label: "即梦 4.5", credits: "按张计费" },
  "jimeng-4.0": { id: 4, family: "seedream", label: "即梦 4.0", credits: "按张计费" },
  flux: { id: 1, family: "flux", label: "FLUX", credits: "按张计费" },
  google: { id: 5, family: "nano", label: "Google 原生生图", credits: "按张计费" },
};

const MODEL_ALIASES = {
  "电商模型3.0": "gemini-3",
  "电商模型3": "gemini-3",
  "gemini3": "gemini-3",
  "电商模型2.0": "nano-banana-pro",
  "nano-banana-2": "nano-banana-pro",
  "banana": "nano-banana-pro",
  "电商模型1.0": "nano-banana-2-lite",
  "nano-banana": "nano-banana-2-lite",
  "gpt2": "gpt-image-2",
  "seedream-5": "seedream-5-pro",
  "seedream": "seedream-5-pro",
  "jimeng": "jimeng-4.5",
};

const DEFAULT_MODEL = "gemini-3";

export function resolveModel(name) {
  if (!name) return { key: DEFAULT_MODEL, ...MODELS[DEFAULT_MODEL] };
  const raw = String(name).trim();
  const key = MODELS[raw] ? raw : MODEL_ALIASES[raw.toLowerCase()] || MODEL_ALIASES[raw];
  if (!key || !MODELS[key]) {
    throw new Error(`未知模型：${name}。可用：${Object.keys(MODELS).join(", ")}`);
  }
  return { key, ...MODELS[key] };
}

/** 1K / 2K / 2K+ → standard / high / super */
export const SIZE_TO_QUALITY = { "1K": "standard", "2K": "high", "2K+": "super", "4k": "super", "4K": "super" };

/** 尺寸表（GPT_IMAGE_2 系需要显式 dimension） */
const DIMENSIONS = {
  "1:1": { standard: "1024x1024", high: "2048x2048", super: "2880x2880" },
  "2:3": { standard: "1024x1536", high: "1360x2048", super: "2336x3504" },
  "3:2": { standard: "1536x1024", high: "2048x1360", super: "3504x2336" },
  "3:4": { standard: "1152x1536", high: "1536x2048", super: "2448x3264" },
  "4:3": { standard: "1536x1152", high: "2048x1536", super: "3264x2448" },
  "9:16": { standard: "864x1536", high: "1152x2048", super: "2160x3840" },
  "16:9": { standard: "1536x864", high: "2048x1152", super: "3840x2160" },
  "970:600": { standard: "1536x950", high: "2048x1268", super: "3072x1901" },
};

export const RATIOS = ["auto", ...Object.keys(DIMENSIONS)];

export function dimensionFor(ratio, sizeName) {
  const table = DIMENSIONS[ratio] || DIMENSIONS["1:1"];
  const level = SIZE_TO_QUALITY[sizeName] || "high";
  return table[level] || table.high;
}

/** 电商套图场景：站点 UI 的 7 个选项里 5 个已确认可用。 */
export const SUITE_SCENES = {
  main: "白底主图",
  core: "核心卖点图",
  selling: "卖点图",
  material: "材质图",
  person: "模特展示图",
};

export const SUITE_SITES = {
  amazon: { country: "US", lang: "en", label: "亚马逊" },
  taobao: { country: "CN", lang: "zh", label: "淘宝/天猫/1688" },
  temu: { country: "US", lang: "en", label: "TEMU" },
  pdd: { country: "CN", lang: "zh", label: "拼多多" },
  shein: { country: "US", lang: "en", label: "SHEIN" },
  ozon: { country: "RU", lang: "ru", label: "OZON" },
  tiktok: { country: "US", lang: "en", label: "TikTok Shop" },
  douyin: { country: "CN", lang: "zh", label: "抖音电商" },
  shopee: { country: "WX_DNY", lang: "en", label: "Shopee" },
  kuaishou: { country: "CN", lang: "zh", label: "快手电商" },
  xiaohongshu: { country: "CN", lang: "zh", label: "小红书电商" },
  ali: { country: "US", lang: "en", label: "阿里国际站" },
  jd: { country: "CN", lang: "zh", label: "京东" },
  walmart: { country: "US", lang: "en", label: "Walmart" },
  coupang: { country: "KR", lang: "ko", label: "Coupang" },
};

/**
 * 组装 tasks/login/image-messages 的请求体。
 * 不同模型族接受的字段不同，多余字段会被服务端忽略，缺失关键字段会报参数错误。
 */
export function buildImageMessagePayload({
  prompt,
  conversationId,
  messageId,
  modelId,
  family,
  files,
  ratio = "auto",
  sizeName = "2K",
  pattern = "economy",
  format = "png",
  background = "auto",
  isContinue = false,
}) {
  const base = {
    prompt,
    ...(files && files.length ? { files } : {}),
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(messageId ? { message_id: messageId } : {}),
    model_type: modelId,
    is_continue: isContinue,
  };
  const auto = !ratio || ratio === "auto";
  const quality = SIZE_TO_QUALITY[sizeName] || "high";

  switch (family) {
    case "gpt2":
      return {
        ...base,
        pattern,
        output_format: format,
        background,
        quality,
        resolution: quality,
        size: auto ? "" : ratio,
        dimension: dimensionFor(auto ? "1:1" : ratio, sizeName),
      };
    case "gpt1":
      return { ...base, output_format: format, quality: quality === "standard" ? "default" : "high", size: auto ? "" : ratio };
    case "seedream":
      return { ...base, output_format: format, quality, size: auto ? "" : ratio, quantity: -1 };
    case "flux":
      return { ...base, output_format: format, quality, size: auto ? "" : ratio };
    case "nano":
    default:
      return { ...base, pattern, ...(quality === "high" || quality === "super" ? { quality } : {}), size: auto ? "" : ratio };
  }
}
