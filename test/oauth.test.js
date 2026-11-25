import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  CODE_TTL_MS,
  createPkce,
  verifyChallenge,
  newState,
  isValidToken,
  startLoopbackAuth,
  base64url,
} from "../src/oauth.js";

const TOKEN = "v2,30996077,482,4a2ce5e27c92d37ffcc7e4a3529b820b";

function cidOf(html) {
  const m = html.match(/id="cid" value="([^"]+)"/);
  assert.ok(m, "授权页应包含 cid");
  return m[1];
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
  const a = newState();
  const b = newState();
  assert.notEqual(a, b);
  assert.ok(/^[A-Za-z0-9_-]{22}$/.test(a));
});

test("token 格式校验", () => {
  assert.ok(isValidToken(TOKEN));
  assert.ok(!isValidToken("v2,x,482,abc"));
  assert.ok(!isValidToken("v2,1,482,short"));
  assert.ok(!isValidToken(""));
  assert.ok(!isValidToken(null));
});

test("base64url 无填充字符", () => {
  assert.ok(!/[+/=]/.test(base64url(Buffer.from([0xfb, 0xff, 0xbf]))));
});

test("完整授权码 + PKCE 流程：authorize → grant → callback → token", async () => {
  const auth = await startLoopbackAuth({ timeoutMs: 8000 });
  assert.match(auth.authorizeUrl, /response_type=code/);
  assert.match(auth.authorizeUrl, /code_challenge_method=S256/);

  const bad = await fetch(`${auth.origin}/authorize?response_type=code&state=wrong`);
  assert.equal(bad.status, 400);

  const pageRes = await fetch(auth.authorizeUrl);
  assert.equal(pageRes.status, 200);
  const html = await pageRes.text();
  assert.match(html, /javascript:.*localStorage\.getItem/);
  const cid = cidOf(html);

  const grant = await fetch(`${auth.origin}/grant?cid=${encodeURIComponent(cid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: auth.state }),
  });
  assert.equal(grant.status, 200);
  const grantJson = await grant.json();
  assert.equal(grantJson.status, "granted");
  const redirect = new URL(grantJson.redirect);
  assert.equal(redirect.pathname, "/callback");
  assert.equal(redirect.searchParams.get("state"), auth.state);
  const code = redirect.searchParams.get("code");
  assert.ok(code);

  const cb = await fetch(grantJson.redirect);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /授权完成/);
  const { token } = await auth.waitForToken();
  assert.equal(token, TOKEN);

  // replay 在服务器关闭后发起（server.close() 会拒绝新连接，返回 ECONNRESET）
  await assert.rejects(
    fetch(`${auth.origin}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(auth.state)}`),
  );
  await auth.close();
});

test("form 提交（书签路径）返回 303 跳转", async () => {
  const auth = await startLoopbackAuth({ timeoutMs: 8000 });
  const html = await (await fetch(auth.authorizeUrl)).text();
  const cid = cidOf(html);
  const res = await fetch(`${auth.origin}/grant?cid=${encodeURIComponent(cid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: TOKEN, state: auth.state }),
    redirect: "manual",
  });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /\/callback\?code=/);
  // 完成流程，避免留下挂起的 promise
  await fetch(new URL(res.headers.get("location"), auth.origin));
  await auth.waitForToken();
});

test("非法 token 被拒绝", async () => {
  const auth = await startLoopbackAuth({ timeoutMs: 8000 });
  const cid = cidOf(await (await fetch(auth.authorizeUrl)).text());
  const res = await fetch(`${auth.origin}/grant?cid=${encodeURIComponent(cid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "nope", state: auth.state }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /token/);
  await auth.close();
});

test("state 不匹配时拒绝 grant", async () => {
  const auth = await startLoopbackAuth({ timeoutMs: 8000 });
  const cid = cidOf(await (await fetch(auth.authorizeUrl)).text());
  const res = await fetch(`${auth.origin}/grant?cid=${encodeURIComponent(cid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, state: "wrong-state" }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /state/);
  await auth.close();
});

test("非本机 Host 被拒绝（DNS rebinding 防护）", async () => {
  const auth = await startLoopbackAuth({ timeoutMs: 8000 });
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

test("授权超时会 reject", async () => {
  const auth = await startLoopbackAuth({ timeoutMs: 150 });
  await assert.rejects(() => auth.waitForToken(), /授权超时/);
});

test("CODE_TTL 为 60 秒", () => {
  assert.equal(CODE_TTL_MS, 60_000);
});
