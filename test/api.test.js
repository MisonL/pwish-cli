import assert from "node:assert/strict";
import test from "node:test";
import { describeApiError } from "../src/api.js";

test("describeApiError 用中文语义替换已知错误码", () => {
  const credit = describeApiError(15546, { message: "use count exceed" });
  assert.equal(credit.code, "CREDIT_NOT_ENOUGH");
  assert.match(credit.message, /算粒不足/);
  assert.match(credit.message, /use count exceed/);

  const unauth = describeApiError(401);
  assert.equal(unauth.code, "UNAUTHORIZED");
  assert.match(unauth.message, /重新执行 `pwish login`/);
});

test("describeApiError 对未知状态码保留原始信息", () => {
  const unknown = describeApiError(15599, { message: "something odd" });
  assert.equal(unknown.code, "API_15599");
  assert.match(unknown.message, /接口返回 15599/);
  assert.match(unknown.message, /something odd/);
});

test("describeApiError 在没有服务端 message 时也不产生空尾巴", () => {
  assert.equal(describeApiError(15500).message.includes(" · "), false);
  assert.equal(describeApiError(401).message.includes(" · "), false);
});

test("describeApiError 负数码同样映射（-16 / -30）", () => {
  assert.equal(describeApiError(-16).code, "IMAGE_POLICY_VIOLATION");
  assert.equal(describeApiError(-30).code, "INVALID_WORDS");
  assert.match(describeApiError(-30).message, /违禁词/);
});

test("GET 网络错误会重试，POST 不会重试", async () => {
  const { createClient } = await import("../src/api.js");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    throw Object.assign(new Error("socket hang up"), { name: "TypeError" });
  };
  try {
    const client = createClient({ token: "v2,1,482,deadbeefdeadbeefdeadbeefdeadbeef", apiBase: "https://example.test" });
    await assert.rejects(() => client.request("image/conversations"), /网络请求失败/);
    const getCalls = calls.length;
    assert.equal(getCalls, 3, "GET 默认 1 次 + 2 次重试");

    calls.length = 0;
    await assert.rejects(() => client.request("tasks/login/suite", { method: "POST", body: {} }), /网络请求失败/);
    assert.equal(calls.length, 1, "POST 只发一次");
  } finally {
    globalThis.fetch = realFetch;
  }
});
