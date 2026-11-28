import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { CODE_TTL_MS, createPkce, verifyChallenge, newState, isValidToken, startAuthServer, base64url } from "../src/auth-server.js";

const TOKEN = "v2,10000001,482,0123456789abcdef0123456789abcdef";

function stateOf(auth) {
  return auth.state;
}

/** 登录页必须先被打开（记录 UA），后续 /api/** 与 /session 才允许调用。 */
async function openPage(auth) {
  const res = await fetch(auth.authorizeUrl);
  assert.equal(res.status, 200);
  return res;
}

test("PKCE S256 challenge 正确且可校验", () => {
  const { verifier, challenge, method } = createPkce();
  assert.equal(method, "S256");
  assert.equal(challenge.length, 43);
  assert.ok(verifyChallenge(verifier, challenge));
  assert.ok(!verifyChallenge("wrong", challenge));
  assert.ok(!verifyChallenge(verifier, "wrong"));
  assert.ok(!verifyChallenge("", ""));
});

test("state 随机且每次不同", () => {
  assert.notEqual(newState(), newState());
  assert.ok(/^[A-Za-z0-9_-]{22}$/.test(newState()));
});

test("token 格式校验", () => {
  assert.ok(isValidToken(TOKEN));
  assert.ok(!isValidToken("v2,x,482,abc"));
  assert.ok(!isValidToken(""));
  assert.ok(!isValidToken(null));
});

test("base64url 无填充字符", () => {
  assert.ok(!/[+/=]/.test(base64url(Buffer.from([0xfb, 0xff, 0xbf]))));
});

test("登录页可访问且包含自建登录 UI", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  const res = await fetch(auth.authorizeUrl);
  assert.equal(res.status, 200);
  const html = await res.text();
  // 自建登录页要素：品牌、两种登录方式、与本机服务通信
  assert.match(html, /佐糖/);
  assert.match(html, /微信扫码/);
  assert.match(html, /密码登录/);
  assert.match(html, /\/api\/qrcode/);
  assert.match(html, /\/api\/login\/password/);
  // 不应再出现旧的书签方案
  assert.doesNotMatch(html, /javascript:\(function/);
  assert.doesNotMatch(html, /localStorage\.getItem/);
});

test("state 不匹配时拒绝打开授权页", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  const res = await fetch(`${auth.origin}/authorize?response_type=code&state=wrong`);
  assert.equal(res.status, 400);
});

test("完整授权码 + PKCE 流程：登录页 → session → callback → token", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);

  // 页面把登录拿到的 token 回传本机服务
  const session = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: stateOf(auth) }),
  });
  assert.equal(session.status, 200);
  const { redirect } = await session.json();
  const url = new URL(redirect);
  assert.equal(url.pathname, "/callback");
  assert.equal(url.searchParams.get("state"), stateOf(auth));
  const code = url.searchParams.get("code");
  assert.ok(code);

  const cb = await fetch(redirect);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /授权完成/);

  const { token } = await auth.waitForToken();
  assert.equal(token, TOKEN);
});

test("session 拒绝非法 token", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);
  const res = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "not-a-token", state: stateOf(auth) }),
  });
  assert.equal(res.status, 400);
});

test("session 拒绝错误 state", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);
  const res = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: "wrong" }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /state/);
});

test("授权码一次性：服务还活着时重放就被拒绝", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);
  const session = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: stateOf(auth) }),
  });
  const { redirect } = await session.json();

  const first = await fetch(redirect);
  assert.equal(first.status, 200);

  // 关键：此时还没调 waitForToken（它会关闭服务），所以重放是真的打到了活着的服务上，
  // 400 才证明「授权码被消费」，而不是「连不上所以失败」。
  const replay = await fetch(redirect);
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /授权码/);

  const { token } = await auth.waitForToken();
  assert.equal(token, TOKEN);
});

test("非本机 Host 被拒绝（DNS rebinding 防护）", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: auth.port, path: "/authorize", headers: { Host: "evil.example:6666" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("超时会 reject", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 150 });
  t.after(() => auth.close());
  await assert.rejects(() => auth.waitForToken(), /超时/);
});

test("CODE_TTL 为 60 秒", () => {
  assert.equal(CODE_TTL_MS, 60_000);
});

test("端口占用时给出可读的错误提示", async (t) => {
  const a = await startAuthServer({ timeoutMs: 5000 });
  t.after(() => a.close());
  await assert.rejects(
    () => startAuthServer({ timeoutMs: 5000, port: a.port }),
    /端口 .* 已被占用/,
  );
});

test("/api/* 请求体损坏时返回 JSON 且带可读错误（不依赖上游网络）", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);
  const res = await fetch(`${auth.origin}/api/qrcode/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.message, /请求格式不正确/);
});

test("CODE_TTL 到期后授权码被拒（用 0 秒 TTL 验证过期分支）", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000, codeTtlMs: 0 });
  t.after(() => auth.close());
  await openPage(auth);
  const session = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: auth.state }),
  });
  const { redirect } = await session.json();
  const res = await fetch(redirect);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /过期/);
});

test("登录相关接口必须带匹配的 state，本机其他进程不能凭空轮询二维码", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);

  const noState = await fetch(`${auth.origin}/api/qrcode`, { method: "POST" });
  assert.equal(noState.status, 400);

  const wrongState = await fetch(`${auth.origin}/api/qrcode/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hashKey: "whatever", state: "wrong" }),
  });
  assert.equal(wrongState.status, 400);

  const badPassword = await fetch(`${auth.origin}/api/login/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: "a", password: "b" }),
  });
  assert.equal(badPassword.status, 400);
});

test("/health 不回显 state", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  const res = await fetch(`${auth.origin}/health`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.state, undefined);
});

test("不是打开登录页的那个 UA 一律 403（本机其他进程拿到 state 也没用）", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);

  const res = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "evil-local-process/1.0" },
    body: JSON.stringify({ token: TOKEN, state: auth.state }),
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).message, /不是来自登录页/);
});

test("凭据只交接一次：第二次 /session 返回 409", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  t.after(() => auth.close());
  await openPage(auth);

  const post = () =>
    fetch(`${auth.origin}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, state: auth.state }),
    });

  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 409);
});

test("二维码轮询有节流，短时间内连刷返回 429", async (t) => {
  const auth = await startAuthServer({ timeoutMs: 8000, pollQr: async () => ({ status: "waiting" }) });
  t.after(() => auth.close());
  await openPage(auth);
  const poll = () =>
    fetch(`${auth.origin}/api/qrcode/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashKey: "k", state: auth.state }),
    });
  const first = await poll();
  assert.notEqual(first.status, 429);
  const second = await poll();
  assert.equal(second.status, 429);
});
