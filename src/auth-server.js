import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { renderLoginPage, renderDonePage, renderErrorPage } from "./login-page.js";
import { loginWithPassword, requestWechatQr, pollWechatQr, LoginError } from "./passport.js";

/**
 * 本机授权服务：既提供自建登录页，也承担 OAuth 2.0 授权端点的职责。
 *
 * 流程（RFC 6749 授权码 + RFC 7636 PKCE + RFC 8252 loopback）：
 *   1. CLI 起服务，生成 state 与 PKCE 对，打开 /authorize
 *   2. 用户在页面上用佐糖账号登录（微信扫码 / 手机号或邮箱 + 密码）
 *   3. 页面把凭据交给本机服务 → 服务向官方接口换取 api_token
 *   4. 服务签发一次性授权码，浏览器跳到 /callback?code&state
 *   5. CLI 校验 state 与 PKCE 后收下 token
 *
 * 安全约束：只监听 127.0.0.1、校验 Host 防 DNS rebinding、state 一次性、
 * 授权码 60 秒且单次使用、token 只经 POST body 与内存传递，不写日志。
 */

export const CODE_TTL_MS = 60_000;
const TOKEN_PATTERN = /^v2,\d+,\d+,[0-9a-fA-F]{16,}$/;

export function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

export function verifyChallenge(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const computed = base64url(crypto.createHash("sha256").update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newState() {
  return base64url(crypto.randomBytes(16));
}

export function isValidToken(token) {
  return typeof token === "string" && TOKEN_PATTERN.test(token.trim());
}

export function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => execFile(cmd, args, (err) => resolve(!err)));
}

function escapeHtml(str) {
  return String(str).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
}

function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * 启动本机授权服务。
 * @returns {Promise<{port:number, origin:string, authorizeUrl:string, state:string,
 *   waitForToken:()=>Promise<{token:string}>, close:()=>Promise<void>}>}
 */
export function startAuthServer({
  timeoutMs = 600_000,
  port = 0,
  host = "127.0.0.1",
  autoRefreshQr = true,
  codeTtlMs = CODE_TTL_MS, // 仅测试注入用：验证过期分支
  pollQr = pollWechatQr, // 仅测试注入用：避免用例依赖上游网络
} = {}) {
  const pkce = createPkce();
  const state = newState();
  const codes = new Map(); // code -> { token, challenge, expiresAt }
  let qrCache = null; // { hashKey, qrUrl, at }
  let settled = false;

  let resolveToken;
  let rejectToken;
  const tokenPromise = new Promise((res, rej) => {
    resolveToken = res;
    rejectToken = rej;
  });
  tokenPromise.catch(() => {});

  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn(value);
  };

  const issueCode = (token) => {
    const code = base64url(crypto.randomBytes(32));
    codes.set(code, { token, challenge: pkce.challenge, expiresAt: Date.now() + codeTtlMs });
    return code;
  };

  const redeemCode = (code) => {
    const entry = codes.get(code);
    if (!entry) return { error: "无效的授权码" };
    codes.delete(code);
    // 用 >= ：TTL 为 0 时应立即过期，而不是「同一毫秒内仍可用」
    if (Date.now() >= entry.expiresAt) return { error: "授权码已过期" };
    if (!verifyChallenge(pkce.verifier, entry.challenge)) return { error: "PKCE 校验失败" };
    return { token: entry.token };
  };

  let origin = "";
  let pageUA = null; // 打开登录页的浏览器 UA，后续 API 必须来自同一个 UA
  let tokenPosted = false; // 凭据只允许交接一次
  let lastPollAt = 0; // 二维码轮询节流

  const server = http.createServer(async (req, res) => {
    const actualPort = server.address()?.port ?? port;
    const url = new URL(req.url, `http://${req.headers.host || host}`);

    const hostHeader = String(req.headers.host || "");
    const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^(${esc(host)}|localhost):${actualPort}$`).test(hostHeader)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("forbidden host");
      return;
    }

    const sendHtml = (code, body) => {
      res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
    };
    const sendJson = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(obj));
    };

    /** 只接受与打开登录页相同的 UA：本机其他进程即使拿到 state 也过不了这一关。 */
    const fromLoginPage = () => pageUA !== null && String(req.headers["user-agent"] || "") === pageUA;

    try {
      // 授权端点：登录页
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/authorize")) {
        if (url.searchParams.get("state") !== state) {
          sendHtml(400, renderErrorPage("state 不匹配，请重新执行 pwish login"));
          return;
        }
        pageUA = String(req.headers["user-agent"] || "");
        sendHtml(200, renderLoginPage({ origin, state }));
        return;
      }

      // 微信二维码：state 必须匹配，否则别的本机进程拿不到二维码轮询入口
      if (req.method === "POST" && url.pathname === "/api/qrcode") {
        if (!fromLoginPage()) {
          sendJson(403, { message: "请求不是来自登录页" });
          return;
        }
        const body = await readJsonBody(req);
        if (body.state !== state) {
          sendJson(400, { message: "state 不匹配" });
          return;
        }
        if (qrCache && autoRefreshQr && Date.now() - qrCache.at < 120_000) {
          sendJson(200, { hashKey: qrCache.hashKey, qrUrl: qrCache.qrUrl });
          return;
        }
        const qr = await requestWechatQr();
        qrCache = { ...qr, at: Date.now(), state };
        sendJson(200, qr);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/qrcode/poll") {
        if (!fromLoginPage()) {
          sendJson(403, { message: "请求不是来自登录页" });
          return;
        }
        const body = await readJsonBody(req);
        if (body.state !== state) {
          sendJson(400, { message: "state 不匹配" });
          return;
        }
        if (!body.hashKey) {
          sendJson(400, { message: "缺少 hashKey" });
          return;
        }
        if (qrCache?.state && qrCache.state !== state) {
          sendJson(400, { message: "二维码不属于当前登录会话" });
          return;
        }
        const now = Date.now();
        if (now - lastPollAt < 800) {
          sendJson(429, { message: "轮询过快，请稍候" });
          return;
        }
        lastPollAt = now;
        try {
          const result = await pollQr(String(body.hashKey));
          if (result.status === "waiting") sendJson(200, { status: "waiting" });
          else sendJson(200, { status: "ok", token: result.token });
        } catch (err) {
          if (err instanceof LoginError) {
            qrCache = null; // 失效后允许重新获取
            sendJson(200, { status: "error", message: err.message });
          } else throw err;
        }
        return;
      }

      // 密码登录
      if (req.method === "POST" && url.pathname === "/api/login/password") {
        if (!fromLoginPage()) {
          sendJson(403, { message: "请求不是来自登录页" });
          return;
        }
        const body = await readJsonBody(req);
        if (body.state !== state) {
          sendJson(400, { message: "state 不匹配" });
          return;
        }
        try {
          const result = await loginWithPassword({ account: String(body.account || "").trim(), password: String(body.password || "") });
          sendJson(200, { token: result.token });
        } catch (err) {
          if (err instanceof LoginError) sendJson(200, { message: err.message });
          else throw err;
        }
        return;
      }

      // 页面回传 token → 签发授权码
      if (req.method === "POST" && url.pathname === "/session") {
        if (!fromLoginPage()) {
          sendJson(403, { message: "请求不是来自登录页" });
          return;
        }
        if (tokenPosted) {
          sendJson(409, { message: "本次登录已经交接过凭据，请重新执行 pwish login" });
          return;
        }
        const body = await readJsonBody(req);
        if (body.state !== state) {
          sendJson(400, { message: "state 不匹配" });
          return;
        }
        const token = String(body.token || "").trim();
        if (!isValidToken(token)) {
          sendJson(400, { message: "登录态格式不正确" });
          return;
        }
        tokenPosted = true; // 一次性：交接完任何请求都拿不到第二份凭据
        const code = issueCode(token);
        sendJson(200, {
          redirect: `${origin}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        });
        return;
      }

      // 重定向端点：兑换授权码
      if (req.method === "GET" && url.pathname === "/callback") {
        if (url.searchParams.get("state") !== state) {
          sendHtml(400, renderErrorPage("state 不匹配"));
          return;
        }
        const result = redeemCode(url.searchParams.get("code") || "");
        if (result.error) {
          sendHtml(400, renderErrorPage(result.error));
          return;
        }
        sendHtml(200, renderDonePage());
        settle(resolveToken, { token: result.token });
        return;
      }

      // 健康检查（供测试与调试）
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(200, { ok: true }); // 不回显 state：本机其他进程不该拿到登录事务标识
        return;
      }

      sendHtml(404, renderErrorPage("未知路径"));
    } catch (err) {
      // /api/* 必须回 JSON，否则前端解析 HTML 失败，用户只会看到「无法连接本机服务」
      const friendly = { BODY_TOO_LARGE: "请求体过大", BAD_JSON: "请求格式不正确" }[err.message] || err.message;
      if (url.pathname.startsWith("/api/")) {
        sendJson(500, { message: `服务异常：${friendly}` });
      } else {
        sendHtml(500, renderErrorPage(`服务异常：${escapeHtml(friendly)}`));
      }
    }
  });

  const timer = setTimeout(() => settle(rejectToken, new Error("登录超时，未完成授权")), timeoutMs);

  const shutdown = () =>
    new Promise((resolve) => {
      clearTimeout(timer);
      try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch {
        /* 老版本 Node 无这两个方法 */
      }
      // 兜底：个别 Node 版本下 close 回调可能迟迟不来，别让 CLI/测试挂死在这里
      const fallback = setTimeout(resolve, 3000);
      fallback.unref?.();
      server.close(() => {
        clearTimeout(fallback);
        resolve();
      });
    });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      clearTimeout(timer);
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `端口 ${port} 已被占用。换一个端口重试：pwish login --port ${port + 1}，或省略 --port 让系统自动分配`,
          ),
        );
        return;
      }
      reject(err);
    });
    server.listen(port, host, () => {
      const actual = server.address().port;
      origin = `http://${host}:${actual}`;
      const authorizeUrl =
        `${origin}/authorize?response_type=code&client_id=pwish-cli` +
        `&state=${encodeURIComponent(state)}` +
        `&code_challenge=${encodeURIComponent(pkce.challenge)}&code_challenge_method=S256`;
      resolve({
        port: actual,
        origin,
        authorizeUrl,
        state,
        async waitForToken() {
          try {
            return await tokenPromise;
          } finally {
            await shutdown();
          }
        },
        close: shutdown,
      });
    });
  });
}
