import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { CODE_TTL_MS, createPkce, verifyChallenge, newState, isValidToken, startAuthServer, base64url } from "../src/auth-server.js";

const TOKEN = "v2,10000001,482,0123456789abcdef0123456789abcdef";

function stateOf(auth) {
  return auth.state;
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

test("登录页可访问且包含自建登录 UI", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
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
  await auth.close();
});

test("state 不匹配时拒绝打开授权页", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  const res = await fetch(`${auth.origin}/authorize?response_type=code&state=wrong`);
  assert.equal(res.status, 400);
  await auth.close();
});

test("完整授权码 + PKCE 流程：登录页 → session → callback → token", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });

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
  await auth.close();
});

test("session 拒绝非法 token", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  const res = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "not-a-token", state: stateOf(auth) }),
  });
  assert.equal(res.status, 400);
  await auth.close();
});

test("session 拒绝错误 state", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  const res = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: "wrong" }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /state/);
  await auth.close();
});

test("授权码一次性：重复回调失败", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  const session = await fetch(`${auth.origin}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: stateOf(auth) }),
  });
  const { redirect } = await session.json();
  assert.equal((await fetch(redirect)).status, 200);
  await auth.waitForToken();
  // 服务已关闭，重放会被拒绝
  await assert.rejects(fetch(redirect));
  await auth.close();
});

test("非本机 Host 被拒绝（DNS rebinding 防护）", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
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
  await auth.close();
});

test("超时会 reject", async () => {
  const auth = await startAuthServer({ timeoutMs: 150 });
  await assert.rejects(() => auth.waitForToken(), /超时/);
});

test("CODE_TTL 为 60 秒", () => {
  assert.equal(CODE_TTL_MS, 60_000);
});

test("端口占用时给出可读的错误提示", async () => {
  const a = await startAuthServer({ timeoutMs: 5000 });
  await assert.rejects(
    () => startAuthServer({ timeoutMs: 5000, port: a.port }),
    /端口 .* 已被占用/,
  );
  await a.close();
});

test("/api/* 异常时返回 JSON 而非 HTML", async () => {
  const auth = await startAuthServer({ timeoutMs: 8000 });
  // 伪造 hashKey 触发上游调用，当前网络环境下至少不会返回 HTML
  const res = await fetch(`${auth.origin}/api/qrcode/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hashKey: "bad-key" }),
  });
  const text = await res.text();
  assert.ok(!text.startsWith("<!doctype"), "API 错误不应返回 HTML");
  await auth.close();
});
