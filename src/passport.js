/**
 * 佐糖账号登录接口客户端（自建登录页的后端）。
 *
 * 登录页本身由本机 loopback 服务提供，页面只与本机通信；
 * 真正的账号校验由这里的函数转发到官方 passport 服务完成，
 * 因此密码/扫码等敏感信息不经过任何第三方，也不落盘。
 */

const PASSPORT_BASE = process.env.PWISH_PASSPORT_BASE || "https://gw.aoscdn.com/base/passport/v2";

/** 官方网页版登录使用的微信开放平台应用 id。 */
export const WECHAT_CLIENT_ID = "wxd6d7038d8f2449ea";

export class LoginError extends Error {
  constructor(message, code = "LOGIN_FAILED") {
    super(message);
    this.name = "LoginError";
    this.code = code;
  }
}

/** 官方接口的状态码 → 用户可读文案。 */
const STATUS_MESSAGES = {
  11000: "账号不存在",
  11070: "验证码不正确",
  11211: "邮箱未注册",
  11212: "手机号未注册",
  11216: "该账号未设置密码，请改用微信扫码登录",
  11302: "微信应用配置缺失",
  11308: "二维码已失效，请刷新",
  11314: "等待扫码",
  11317: "需要完成安全验证",
  11320: "需要完成安全验证",
};

export function describeStatus(status, fallback = "") {
  return STATUS_MESSAGES[status] || fallback || `登录失败（${status}）`;
}

async function callPassport(path, { body, method = "POST", query = {} } = {}) {
  const url = new URL(`${PASSPORT_BASE}/${path}`);
  url.searchParams.set("product_id", "482");
  url.searchParams.set("language", "zh");
  url.searchParams.set("cli_os", "web");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Origin: "https://picwish.cn", Referer: "https://picwish.cn/login" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new LoginError(`登录服务返回了非 JSON 响应（HTTP ${res.status}）`, "BAD_RESPONSE");
  }
  return { status: res.status, payload };
}

/** 统一把 {status,data} 响应转成 token；失败抛 LoginError。 */
function tokenFrom(payload) {
  const data = payload?.data;
  const token = data?.api_token;
  if (payload?.status === 200 && token) {
    return { token, userId: data.user_id ?? null, profile: data };
  }
  const status = payload?.status;
  if (status && STATUS_MESSAGES[status]) {
    throw new LoginError(describeStatus(status, payload?.message), String(status));
  }
  throw new LoginError(describeStatus(status, payload?.message || "登录失败"), "LOGIN_FAILED");
}

/** 手机号 / 邮箱 + 密码登录。 */
export async function loginWithPassword({ account, password }) {
  const isEmail = String(account).includes("@");
  if (!isEmail && !/^\d{6,15}$/.test(String(account))) {
    throw new LoginError("请输入正确的手机号或邮箱", "INVALID_ACCOUNT");
  }
  if (!password) throw new LoginError("请输入密码", "INVALID_PASSWORD");

  const path = isEmail ? "login/email" : "login/telephone";
  const body = isEmail ? { account, password } : { telephone: account, password };
  const { payload } = await callPassport(path, { body });
  return tokenFrom(payload);
}

/** 申请微信扫码登录二维码。 */
export async function requestWechatQr() {
  const { payload } = await callPassport("qrcode", { body: { client_id: WECHAT_CLIENT_ID } });
  const data = payload?.data;
  if (payload?.status !== 200 || !data?.hash_key || !data?.url) {
    throw new LoginError(describeStatus(payload?.status, "无法获取微信二维码"), "QRCODE_FAILED");
  }
  return { hashKey: data.hash_key, qrUrl: data.url };
}

/**
 * 轮询扫码结果。
 * @returns {{status:"waiting"} | {status:"ok", token:string, userId:number|null}}
 */
export async function pollWechatQr(hashKey) {
  const { payload } = await callPassport("login/qrcode", { body: { hash_key: hashKey } });
  if (payload?.status === 11314) return { status: "waiting" };
  if (payload?.status === 11308) throw new LoginError("二维码已失效，请刷新", "QRCODE_EXPIRED");
  const result = tokenFrom(payload);
  return { status: "ok", ...result };
}
