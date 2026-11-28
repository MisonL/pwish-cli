import { UserError, loadConfig, resolveToken } from "./config.js";
import { netFetch } from "./net.js";

/** Error codes returned by the backend, mapped to stable CLI error names. */
const API_ERRORS = {
  15546: ["CREDIT_NOT_ENOUGH", "算粒不足（用 `pwish quota` 看余额；可换便宜模型或升级会员）"],
  15030: ["DAILY_LIMIT_EXCEEDED", "今日免费额度已用完（次日重置；可换模型或升级会员）"],
  15022: ["SENSITIVE_IMAGE", "参考图被判定为敏感图片"],
  "-16": ["IMAGE_POLICY_VIOLATION", "提示词或图片触发了图片安全策略"],
  "-30": ["INVALID_WORDS", "提示词包含违禁词"],
  15502: ["INVALID_PARAM", "参数不合法（常见于 scene / size / model 取值错误）"],
  15550: ["TASK_CREATION_FAIL", "任务创建失败（服务端排队或限流）"],
  15558: ["FREE_PREVIEW_LIMIT_EXCEEDED", "免费预览次数已用完（升级会员后可继续）"],
  15500: ["TASK_NOT_FOUND", "任务不存在"],
  15021: ["TASK_EXPIRED", "任务已过期（超过 1 小时）"],
  401: ["UNAUTHORIZED", "登录态失效，请重新执行 `pwish login`"],
};

/** 把接口状态码翻译成「人话 + 错误码」，抽出来便于单测。 */
export function describeApiError(status, json = {}) {
  const mapped = API_ERRORS[String(status)];
  const message = mapped
    ? `${mapped[1]}（${mapped[0]}）${json.message ? ` · ${json.message}` : ""}`
    : `接口返回 ${status}${json.message ? `：${json.message}` : ""}`;
  return { message, code: mapped?.[0] || `API_${status}` };
}

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

  /**
   * 发一个请求。
   *
   * 轮询类 GET 会被网络抖动打断（连接重置、DNS 抽风），这类错误重试是安全的；
   * POST 会建任务/扣额度，绝不重试，避免重复扣费。
   */
  async function request(path, { method = "GET", body, query, timeout = 60_000, baseOverride, retries } = {}) {
    const attempts = retries ?? (method === "GET" ? 2 : 0);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send(path, { method, body, query, timeout, baseOverride });
      } catch (err) {
        // GET 是幂等的：网络抖动与 502/503/504 都可以重试；POST 一律不重试，避免重复建任务/扣额度
        const transientStatus = method === "GET" && [502, 503, 504].includes(Number(err.payload?.status ?? 0));
        const retryable = (err.code === "NETWORK_ERROR" || transientStatus) && attempt < attempts;
        if (!retryable) throw err;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  async function send(path, { method = "GET", body, query, timeout = 60_000, baseOverride }) {
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
    let text;
    try {
      res = await netFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      // 响应体读取也在超时保护内：只限制首字节会让卡住的 body 无限期挂起
      text = await res.text();
    } catch (err) {
      throw new ApiError(
        err.name === "AbortError" ? `请求超时：${path}` : `网络请求失败：${err.message}`,
        { code: "NETWORK_ERROR", payload: { url, cause: String(err) } },
      );
    } finally {
      clearTimeout(timer);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`, {
        status: res.status,
        code: "BAD_RESPONSE",
      });
    }

    // HTTP 层失败不能被 body 里的 status:200 掩盖（例如网关回 401 带业务体）
    const status = res.status >= 400 ? res.status : Number(json.status ?? res.status);
    if (status !== 200) {
      const { message, code } = describeApiError(status, json);
      throw new ApiError(message, { status: res.status, code, payload: json });
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
      "token 格式看起来不对。`pwish login` 拿到的 token 形如 `v2,<user_id>,482,<secret>`。",
      "BAD_TOKEN",
    );
  }
  return token.trim();
}
