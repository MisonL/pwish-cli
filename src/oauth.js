import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

/**
 * 自建 OAuth 2.0 授权码 + PKCE（RFC 6749 / RFC 7636 / RFC 8252 loopback redirect）。
 *
 * 角色映射：
 *   - 资源所有者：用户（在浏览器里已登录佐糖）
 *   - 授权服务器：本进程在 127.0.0.1 上临时启动的服务（/authorize、/grant、/token 语义）
 *   - 客户端：CLI 自身，redirect_uri 固定为 127.0.0.1 回环地址
 *
 * 安全属性：
 *   - 只监听 127.0.0.1，校验 Host 头，拒绝 DNS rebinding
 *   - state 防 CSRF，一次性
 *   - PKCE S256 绑定 code 与客户端
 *   - code 一次性、60 秒过期
 *   - token 只出现在 POST body，绝不出现在 URL / 日志里
 */

export const CODE_TTL_MS = 60_000;

export const TOKEN_PATTERN = /^v2,\d+,\d+,[0-9a-fA-F]{16,}$/;

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
  return new Promise((resolve) => {
    execFile(cmd, args, (err) => resolve(!err));
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildBookmarklet(grantUrl) {
  return (
    "javascript:(function(){var t=localStorage.getItem('passport_api_token');" +
    "if(!t){alert('请先在本页登录佐糖，再点这个书签');return}" +
    "var f=document.createElement('form');f.method='POST';f.action=" +
    JSON.stringify(grantUrl) +
    ";" +
    "var i=document.createElement('input');i.type='hidden';i.name='token';i.value=t;" +
    "f.appendChild(i);document.body.appendChild(f);f.submit();})()"
  );
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0f1115;color:#e8eaf0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(560px,92vw);background:#171a21;border:1px solid #262b36;border-radius:16px;padding:28px 28px 24px;
box-shadow:0 24px 60px rgba(0,0,0,.45)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.dot{width:10px;height:10px;border-radius:50%;background:#f2705a;box-shadow:0 0 12px #f2705a}
h1{font-size:19px;margin:0;letter-spacing:.2px}
.sub{color:#8b93a7;font-size:13px;margin:0 0 22px}
ol{margin:0 0 18px;padding-left:20px}
li{margin:10px 0}
.drag{display:inline-block;padding:7px 16px;border-radius:9px;background:#2b6cf6;color:#fff;
text-decoration:none;font-weight:600;cursor:grab;border:1px dashed #7ba3ff}
.drag:active{cursor:grabbing}
.hint{color:#8b93a7;font-size:13px}
textarea{width:100%;height:74px;margin-top:8px;padding:10px 12px;border-radius:9px;
border:1px solid #2c3240;background:#0f1115;color:#e8eaf0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
button{margin-top:10px;padding:9px 18px;border-radius:9px;border:0;background:#2b6cf6;color:#fff;
font-weight:600;font-size:14px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
button.ghost{background:#232833;color:#cfd5e4}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
code{background:#0f1115;border:1px solid #262b36;border-radius:6px;padding:1px 6px;font-size:12.5px}
hr{border:0;border-top:1px solid #262b36;margin:22px 0}
.status{display:flex;align-items:center;gap:8px;margin-top:16px;font-size:13.5px;color:#8b93a7}
.pill{width:8px;height:8px;border-radius:50%;background:#8b93a7}
.pill.ok{background:#38c172;box-shadow:0 0 10px #38c172}
.pill.bad{background:#e55757}
.pill.wait{background:#e6b450;animation:p 1.2s infinite}
@keyframes p{50%{opacity:.35}}
.done{font-size:16px;margin:0 0 6px}
a{color:#7ba3ff}
`;

function page(title, body) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><div class="card">${body}</div></body></html>`;
}

function authorizeBody({ state, cid, bookmarklet, grantUrl, tokenPasteHint }) {
  const bm = escapeHtml(bookmarklet);
  return `
<div class="brand"><span class="dot"></span><h1>授权 pwish 访问佐糖账号</h1></div>
<p class="sub">一次性授权，等价于 OAuth 2.0 授权码流程（PKCE/S256）。本地端口仅本机可访问。</p>
<ol>
  <li><a href="https://picwish.cn/ai-design-create" target="_blank" rel="noopener">打开佐糖 AI 设计师并登录</a>
      <span class="hint">（已登录可跳过）</span></li>
  <li>把这个按钮拖到书签栏：<br>
      <a class="drag" href="${bm}" onclick="event.preventDefault();return false;" title="拖我到书签栏">获取 pwish 授权</a>
      <div class="hint" style="margin-top:6px">拖不动？右键复制链接，添加为书签也可。</div></li>
  <li>回到佐糖页面，点一下刚加的书签 → 自动完成授权并跳转回这里。</li>
</ol>
<hr>
<div class="hint">没有书签栏 / 想手动授权？在佐糖页面按 F12 打开 Console，执行
<code>copy(localStorage.getItem('passport_api_token'))</code>，粘贴到这里：</div>
<textarea id="t" placeholder="v2,&lt;user_id&gt;,482,&lt;secret&gt;" spellcheck="false"></textarea>
<div class="row"><button id="go">使用此 Token 授权</button>
<button class="ghost" id="clr">清空</button></div>
<div class="status" id="s"><span class="pill wait" id="dot"></span><span id="sx">等待授权…</span></div>
<input type="hidden" id="state" value="${escapeHtml(state)}">
<input type="hidden" id="cid" value="${escapeHtml(cid)}">
<script>
(function(){
  var dot=document.getElementById('dot'),sx=document.getElementById('sx');
  var grantUrl=${JSON.stringify(grantUrl)}, state=document.getElementById('state').value;
  async function grant(token){
    if(!token){sx.textContent='请先粘贴 token';dot.className='pill bad';return}
    sx.textContent='正在校验…';dot.className='pill wait';
    try{
      var r=await fetch(grantUrl,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:token,state:state})});
      var j=await r.json();
      if(j.redirect){location.href=j.redirect;return}
      throw new Error(j.message||('HTTP '+r.status));
    }catch(e){sx.textContent='授权失败：'+e.message;dot.className='pill bad'}
  }
  document.getElementById('go').onclick=function(){grant(document.getElementById('t').value.trim())};
  document.getElementById('clr').onclick=function(){document.getElementById('t').value=''};
  document.getElementById('t').addEventListener('keydown',function(e){
    if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();grant(this.value.trim())}
  });
  // 书签路径：轮询授权状态
  setInterval(async function(){
    try{
      var r=await fetch('/status?cid='+encodeURIComponent(document.getElementById('cid').value),{cache:'no-store'});
      var j=await r.json();
      if(j.status==='granted'){sx.textContent='✓ 已授权，正在跳转…';dot.className='pill ok'}
      else if(j.status==='error'){sx.textContent=j.message||'授权失败';dot.className='pill bad'}
    }catch(_){}
  },1200);
})();
</script>`;
}

function successBody() {
  return `
<div class="brand"><span class="dot" style="background:#38c172;box-shadow:0 0 12px #38c172"></span>
<h1>✓ 授权完成</h1></div>
<p class="done">pwish 已拿到登录态，可以关闭这个页面了。</p>
<p class="sub">回到终端即可继续使用；凭证保存在本机 <code>~/.config/pwish/config.json</code>（权限 600）。</p>
<div class="row"><button class="ghost" onclick="window.close()">关闭页面</button></div>`;
}

function errorBody(message) {
  return `
<div class="brand"><span class="dot" style="background:#e55757;box-shadow:0 0 12px #e55757"></span>
<h1>授权失败</h1></div>
<p class="done">${escapeHtml(message)}</p>
<p class="sub">回到终端重新执行 <code>picwish login</code>。</p>`;
}

function readBody(req, limit = 8192) {
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
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseGrantBody(contentType, raw) {
  const type = String(contentType || "");
  if (type.includes("application/json")) {
    try {
      const j = JSON.parse(raw);
      return { token: typeof j.token === "string" ? j.token.trim() : "", state: j.state };
    } catch {
      return { token: "", state: undefined };
    }
  }
  // 书签走的是普通 form POST（application/x-www-form-urlencoded）
  const params = new URLSearchParams(raw);
  return { token: (params.get("token") || "").trim(), state: params.get("state") || undefined };
}

/**
 * 启动一次性回环授权服务。
 * @returns {{port:number, authorizeUrl:string, waitForToken:()=>Promise<{token:string}>, close:()=>Promise<void>}}
 */
export function startLoopbackAuth({ timeoutMs = 300_000, port = 0, host = "127.0.0.1" } = {}) {
  const pkce = createPkce();
  const state = newState();
  const cid = base64url(crypto.randomBytes(12));
  const codes = new Map(); // code -> { token, challenge, expiresAt, used }
  let grantStatus = { status: "pending" };
  let settled = false;

  let resolveToken;
  let rejectToken;
  const tokenPromise = new Promise((res, rej) => {
    resolveToken = res;
    rejectToken = rej;
  });

  // 未 await 时（例如程序化调用）不要让 rejection 变成 unhandled
  tokenPromise.catch(() => {});

  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn(value);
  };

  const issueCode = (token) => {
    const code = base64url(crypto.randomBytes(32));
    codes.set(code, { token, challenge: pkce.challenge, expiresAt: Date.now() + CODE_TTL_MS, used: false });
    return code;
  };

  const redeemCode = (code) => {
    const entry = codes.get(code);
    if (!entry) return { error: "无效的授权码" };
    entry.used = true;
    codes.delete(code);
    if (Date.now() > entry.expiresAt) return { error: "授权码已过期" };
    if (!verifyChallenge(pkce.verifier, entry.challenge)) return { error: "PKCE 校验失败" };
    return { token: entry.token };
  };

  let origin = "";
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || host}`);

    // 防 DNS rebinding：只接受回环 Host
    const hostHeader = String(req.headers.host || "");
    const hostOk = new RegExp(`^(${host}|localhost):${server.address()?.port ?? port}$`).test(hostHeader);
    if (!hostOk) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("forbidden host");
      return;
    }

    const send = (code, body, headers = {}) => {
      res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
      res.end(body);
    };
    const sendJson = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(obj));
    };

    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/authorize")) {
        if (url.searchParams.get("state") !== state) {
          send(400, errorBody("state 不匹配，请重新执行 pwish login"));
          return;
        }
        const grantUrl = `${origin}/grant?cid=${encodeURIComponent(cid)}`;
        send(200, page("授权 pwish", authorizeBody({
          state,
          cid,
          bookmarklet: buildBookmarklet(grantUrl),
          grantUrl,
        })));
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        if (url.searchParams.get("cid") !== cid) {
          sendJson(400, { status: "error", message: "cid 不匹配" });
          return;
        }
        sendJson(200, grantStatus);
        return;
      }

      if (req.method === "POST" && url.pathname === "/grant") {
        if (url.searchParams.get("cid") !== cid) {
          sendJson(400, { status: "error", message: "cid 不匹配" });
          return;
        }
        const raw = await readBody(req);
        const parsed = parseGrantBody(req.headers["content-type"], raw);
        if (parsed.state && parsed.state !== state) {
          grantStatus = { status: "error", message: "state 不匹配" };
          sendJson(400, { status: "error", message: "state 不匹配" });
          return;
        }
        if (!isValidToken(parsed.token)) {
          grantStatus = { status: "error", message: "token 格式不正确" };
          sendJson(400, { status: "error", message: "token 格式不正确（应形如 v2,<uid>,482,<secret>）" });
          return;
        }
        const code = issueCode(parsed.token);
        grantStatus = { status: "granted" };
        const redirect = `${origin}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
        const wantsJson = String(req.headers["content-type"] || "").includes("application/json");
        if (wantsJson) {
          sendJson(200, { status: "granted", redirect });
        } else {
          res.writeHead(303, { Location: redirect, "Cache-Control": "no-store" });
          res.end();
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/callback") {
        if (url.searchParams.get("state") !== state) {
          send(400, errorBody("state 不匹配"));
          return;
        }
        const result = redeemCode(url.searchParams.get("code") || "");
        if (result.error) {
          grantStatus = { status: "error", message: result.error };
          send(400, errorBody(result.error));
          return;
        }
        send(200, successBody());
        settle(resolveToken, { token: result.token });
        return;
      }

      send(404, errorBody("未知路径"));
    } catch (err) {
      send(500, errorBody(`服务异常：${err.message}`));
    }
  });

  const timer = setTimeout(() => {
    settle(rejectToken, new Error("授权超时，未收到登录态"));
  }, timeoutMs);

  // 浏览器/fetch 会保持 keep-alive 连接，只 close() 会一直等；先断连接再关。
  const shutdown = () =>
    new Promise((resolve) => {
      clearTimeout(timer);
      try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch {
        /* 老版本 Node 没有这两个方法 */
      }
      server.close(() => resolve());
    });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    server.listen(port, host, () => {
      const actual = server.address().port;
      origin = `http://${host}:${actual}`;
      const authorizeUrl = `${origin}/authorize?response_type=code&client_id=pwish-cli&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(pkce.challenge)}&code_challenge_method=S256`;
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
        close() {
          return shutdown();
        },
      });
    });
  });
}
