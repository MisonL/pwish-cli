/**
 * 授权登录页的 HTML。
 * 视觉对齐佐糖官网登录页：浅蓝渐变背景 + 白色卡片 + 品牌紫蓝渐变主按钮。
 */

const CSS = `
:root{
  --brand:#5555FF; --brand-dark:#3D3DF6; --brand-soft:#EEEEFF;
  --text:#333333; --text-sub:#666666; --text-mute:#999999;
  --line:#E5E7EB; --field:#FAFAFA; --radius:6px;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;color:var(--text);
  font:16px/1.6 "Microsoft YaHei","微软雅黑","PingFang SC","Hiragino Sans GB","Helvetica Neue",Arial,sans-serif;
  background:
    radial-gradient(1100px 620px at 82% 12%,#dbeafe 0%,rgba(219,234,254,0) 62%),
    radial-gradient(900px 560px at 12% 88%,#e9e4ff 0%,rgba(233,228,255,0) 60%),
    linear-gradient(160deg,#f4f7ff 0%,#eef4ff 45%,#eaf1ff 100%);
  display:flex;align-items:center;justify-content:center;
}
.dots{position:fixed;top:72px;left:86px;width:180px;height:88px;pointer-events:none;
  background-image:radial-gradient(circle,#a9c2f5 1.6px,transparent 1.7px);
  background-size:26px 22px;opacity:.85}
.shell{display:flex;align-items:center;gap:clamp(40px,9vw,150px);padding:32px}
.brand{max-width:330px}
.mark{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.mark svg{width:44px;height:44px}
.mark .name{font-size:30px;font-weight:700;letter-spacing:1px;
  background:linear-gradient(270deg,var(--brand),var(--brand-dark));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.slogan{color:var(--brand);font-size:16px;letter-spacing:.4px}
.card{
  width:374px;background:#fff;border-radius:12px;padding:40px 40px 28px;
  box-shadow:0 18px 48px rgba(85,85,255,.12),0 2px 8px rgba(17,24,39,.04);
  position:relative;
}
.corner{position:absolute;top:0;right:0;width:52px;height:46px;overflow:hidden;border-radius:0 12px 0 0;
  background-image:radial-gradient(circle,rgba(85,85,255,.45) 1.5px,transparent 1.6px);background-size:9px 9px}
h1{font-size:20px;font-weight:600;text-align:center;margin:0 0 26px}
.tabs{display:flex;justify-content:center;gap:28px;margin-bottom:22px}
.tab{background:none;border:0;padding:6px 2px;font-size:15px;color:var(--text-sub);cursor:pointer;
  border-bottom:2px solid transparent;font-family:inherit}
.tab[aria-selected=true]{color:var(--brand);border-bottom-color:var(--brand);font-weight:600}
.field{position:relative;margin-bottom:14px}
input{
  width:100%;height:46px;padding:0 14px;font-size:16px;color:var(--text);font-family:inherit;
  background:var(--field);border:1px solid var(--line);border-radius:var(--radius);outline:none;
  transition:border-color .18s,background .18s;
}
input::placeholder{color:var(--text-mute)}
input:focus{border-color:var(--brand);background:#fff}
.submit{
  width:100%;height:46px;margin-top:8px;border:0;border-radius:var(--radius);cursor:pointer;
  color:#fff;font-size:16px;font-family:inherit;font-weight:500;
  background:linear-gradient(270deg,var(--brand) 50%,var(--brand-dark));
  transition:filter .18s,opacity .18s;
}
.submit:hover{filter:brightness(1.06)}
.submit:disabled{opacity:.6;cursor:default}
.hint{min-height:22px;margin-top:12px;font-size:13px;color:#e55757;text-align:center}
.hint.ok{color:#16a34a}
.qr-wrap{text-align:center}
.qr-wrap img{width:190px;height:190px;border:1px solid var(--line);border-radius:8px;background:#fff}
.qr-tip{margin-top:12px;font-size:14px;color:var(--text-sub)}
.qr-tip b{color:var(--brand)}
.foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);
  font-size:12.5px;color:var(--text-mute);text-align:center;line-height:1.7}
.foot code{background:var(--field);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.switch{margin-top:14px;text-align:center;font-size:14px;color:var(--text-sub)}
.switch a{color:var(--brand);text-decoration:none}
.hidden{display:none !important}
`;

const LOGO_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#5555FF"/><stop offset="1" stop-color="#3D3DF6"/></linearGradient></defs>
<circle cx="15" cy="15" r="4.6" fill="url(#g)" opacity=".55"/>
<circle cx="33" cy="15" r="3.2" fill="url(#g)" opacity=".35"/>
<path d="M24 12c8 0 13 5.4 13 12s-5 12-13 12-13-5.4-13-12 5-12 13-12z" fill="url(#g)" opacity=".16"/>
<path d="M24 17c5.2 0 8.6 3.3 8.6 7.2S29.2 31.4 24 31.4 15.4 28.1 15.4 24.2 18.8 17 24 17z" fill="url(#g)"/>
</svg>`;

export function renderLoginPage({ origin, state }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录并授权 pwish</title>
<style>${CSS}</style>
</head>
<body>
<div class="dots"></div>
<div class="shell">
  <div class="brand">
    <div class="mark">${LOGO_SVG}<span class="name">佐糖</span></div>
    <div class="slogan">用AI让图像处理更简单</div>
  </div>

  <div class="card">
    <div class="corner"></div>
    <h1>登录后授权 pwish</h1>

    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="qr" aria-selected="true">微信扫码</button>
      <button class="tab" role="tab" data-tab="pwd" aria-selected="false">密码登录</button>
    </div>

    <section id="pane-qr" class="qr-wrap">
      <img id="qr" alt="微信登录二维码" width="190" height="190">
      <div class="qr-tip">请使用 <b>微信</b> 扫码登录</div>
      <div class="switch"><a href="#" id="qr-refresh">刷新二维码</a></div>
    </section>

    <section id="pane-pwd" class="hidden">
      <div class="field"><input id="account" autocomplete="username" placeholder="手机号或邮箱"></div>
      <div class="field"><input id="password" type="password" autocomplete="current-password" placeholder="密码"></div>
      <button class="submit" id="do-login">登录</button>
    </section>

    <div class="hint" id="hint"></div>

    <div class="foot">
      凭据仅用于换取登录态，密码不会保存。<br>
      授权后关闭本页即可，终端会自动继续。
    </div>
  </div>
</div>

<script>
(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  var STATE = ${JSON.stringify(state)};
  var hintEl = document.getElementById("hint");
  var qrImg = document.getElementById("qr");
  var pollTimer = null;

  function hint(msg, ok) {
    hintEl.textContent = msg || "";
    hintEl.className = "hint" + (ok ? " ok" : "");
  }

  function finish(token) {
    hint("登录成功，正在授权…", true);
    fetch("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, state: STATE })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.redirect) location.href = j.redirect;
        else hint(j.message || "授权失败");
      })
      .catch(function () { hint("与本机服务的连接中断，请重新执行 pwish login"); });
  }

  /* ---------------- tabs ---------------- */
  var tabs = document.querySelectorAll(".tab");
  function show(name) {
    tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === name)); });
    document.getElementById("pane-qr").classList.toggle("hidden", name !== "qr");
    document.getElementById("pane-pwd").classList.toggle("hidden", name !== "pwd");
    hint("");
  }
  tabs.forEach(function (t) { t.onclick = function () { show(t.dataset.tab); }; });

  /* ---------------- 微信扫码 ---------------- */
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function loadQr() {
    stopPolling();
    hint("正在获取二维码…", true);
    fetch("/api/qrcode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: STATE }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.qrUrl) { hint(j.message || "获取二维码失败"); return; }
        qrImg.src = j.qrUrl;
        hint("");
        pollTimer = setInterval(function () {
          fetch("/api/qrcode/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hashKey: j.hashKey, state: STATE })
          })
            .then(function (r) { return r.json(); })
            .then(function (p) {
              if (p.status === "waiting") return;
              stopPolling();
              if (p.token) finish(p.token);
              else { hint(p.message || "登录失败"); }
            })
            .catch(function () { stopPolling(); hint("轮询失败，请刷新二维码"); });
        }, 2000);
      })
      .catch(function () { hint("无法连接本机服务"); });
  }

  document.getElementById("qr-refresh").onclick = function (e) { e.preventDefault(); loadQr(); };

  /* ---------------- 密码登录 ---------------- */
  var btn = document.getElementById("do-login");
  btn.onclick = function () {
    var account = document.getElementById("account").value.trim();
    var password = document.getElementById("password").value;
    if (!account) { hint("请输入手机号或邮箱"); return; }
    if (!password) { hint("请输入密码"); return; }
    btn.disabled = true;
    hint("正在登录…", true);
    fetch("/api/login/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: account, password: password, state: STATE })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        btn.disabled = false;
        if (j.token) finish(j.token);
        else hint(j.message || "登录失败");
      })
      .catch(function () { btn.disabled = false; hint("无法连接本机服务"); });
  };

  document.getElementById("password").addEventListener("keydown", function (e) {
    if (e.key === "Enter") btn.click();
  });

  loadQr();
})();
</script>
</body>
</html>`;
}

export function renderDonePage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>授权完成</title>
<style>${CSS}
body{flex-direction:column}
.tick{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;
 background:linear-gradient(270deg,var(--brand),var(--brand-dark));margin:0 auto 18px}
.tick svg{width:30px;height:30px}
</style></head><body>
<div class="dots"></div>
<div class="card" style="text-align:center">
  <div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"
   stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
  <h1 style="margin-bottom:10px">授权完成</h1>
  <p style="color:var(--text-sub);font-size:14px;margin:0">pwish 已获取登录态，可以关闭本页了。</p>
  <div class="foot">回到终端即可继续使用</div>
</div>
</body></html>`;
}

export function renderErrorPage(message) {
  const safe = String(message).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>授权失败</title>
<style>${CSS}</style></head><body>
<div class="dots"></div>
<div class="card" style="text-align:center">
  <h1>授权失败</h1>
  <p style="color:#e55757;font-size:14px">${safe}</p>
  <div class="foot">请回到终端重新执行 <code>pwish login</code></div>
</div>
</body></html>`;
}
