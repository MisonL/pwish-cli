import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeUrl } from "../src/tasks.js";

test("assertSafeUrl 只放行 https + 白名单域名", () => {
  const ok = "https://picwishsz.oss-cn-shenzhen.aliyuncs.com/pub/x.png?Expires=1";
  assert.equal(assertSafeUrl(ok), ok);
  assert.ok(assertSafeUrl("https://qncdn.aoscdn.com/a.png"));
  assert.throws(() => assertSafeUrl("http://picwishsz.oss-cn-shenzhen.aliyuncs.com/a.png"), /https/);
  assert.throws(() => assertSafeUrl("https://evil.example.com/a.png"), /白名单/);
  assert.throws(() => assertSafeUrl("https://aliyuncs.com.evil.com/a.png"), /白名单/);
  assert.throws(() => assertSafeUrl("not-a-url"), /不合法/);
});
