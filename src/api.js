import { UserError, loadConfig, resolveToken } from "./config.js";

/** Error codes returned by the backend, mapped to stable CLI error names. */
export const API_ERRORS = {
  15546: ["CREDIT_NOT_ENOUGH", "算粒不足，本次生成需要的算粒不够"],
  15030: ["DAILY_LIMIT_EXCEEDED", "今日免费额度已用完"],
  15022: ["SENSITIVE_IMAGE", "参考图被判定为敏感图片"],
  "-16": ["IMAGE_POLICY_VIOLATION", "提示词或图片触发了图片安全策略"],
  "-30": ["INVALID_WORDS", "提示词包含违禁词"],
  15502: ["INVALID_PARAM", "参数不合法（常见于 scene / size / model 取值错误）"],
  15550: ["TASK_CREATION_FAIL", "任务创建失败（服务端排队或限流）"],
  15558: ["FREE_PREVIEW_LIMIT_EXCEEDED", "免费预览次数已用完"],
  15500: ["TASK_NOT_FOUND", "任务不存在"],
  15021: ["TASK_EXPIRED", "任务已过期（超过 1 小时）"],
  401: ["UNAUTHORIZED", "登录态失效，请重新执行 `pwish login`"],
};

export class ApiError extends Error {
  constructor(message, { status, code, payload } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function createClient(overrides = {}) {
  const cfg = { ...loadConfig(), ...overrides };
  const token = resolveToken(cfg);
  const base = `${cfg.apiBase.replace(/\/$/, "")}`;
  const common = new URLSearchParams({
    product_id: String(cfg.productId),
    language: cfg.language || "zh",
  });

  async function request(path, { method = "GET", body, query, timeout = 60_000, baseOverride } = {}) {
    const root = baseOverride || base;
    const params = new URLSearchParams(common);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const url = `${root}/${path.replace(/^\//, "")}?${params}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApiError(
        err.name === "AbortError" ? `请求超时：${path}` : `网络请求失败：${err.message}`,
        { code: "NETWORK_ERROR", payload: { url, cause: String(err) } },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`, {
        status: res.status,
        code: "BAD_RESPONSE",
      });
    }

    const status = Number(json.status ?? res.status);
    if (status !== 200) {
      const mapped = API_ERRORS[String(status)];
      const message = mapped
        ? `${mapped[1]}（${mapped[0]}）${json.message ? ` · ${json.message}` : ""}`
        : `接口返回 ${status}${json.message ? `：${json.message}` : ""}`;
      throw new ApiError(message, { status: res.status, code: mapped?.[0] || `API_${status}`, payload: json });
    }
    return json;
  }

  return {
    cfg,
    token,
    base,
    request,
    /** Absolute URL for a path on the same API base (used for OSS-adjacent helpers). */
    abs(path) {
      return `${base}/${path.replace(/^\//, "")}?${common}`;
    },
  };
}

export function loginWithToken(token) {
  if (!token || !/^v2,/.test(token.trim())) {
    throw new UserError(
      "token 格式看起来不对。它来自浏览器 localStorage 的 passport_api_token，形如 `v2,<user_id>,482,<secret>`。",
      "BAD_TOKEN",
    );
  }
  return token.trim();
}
