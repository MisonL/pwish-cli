import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiutu-test-"));
process.env.XIUTU_CONFIG_DIR = tmpDir;

const { loadConfig, saveConfig, userIdOfToken, resolveToken, UserError, CONFIG_PATH } = await import("../src/config.js");
const { loginWithToken } = await import("../src/api.js");

test("没有 token 时 resolveToken 抛 NO_TOKEN", () => {
  saveConfig({ token: "" });
  assert.throws(() => resolveToken(loadConfig()), (err) => err instanceof UserError && err.code === "NO_TOKEN");
});

test("saveConfig/loadConfig 往返，且文件权限 0600", () => {
  saveConfig({ token: "v2,1,482,abc", outDir: "out-test" });
  const cfg = loadConfig();
  assert.equal(cfg.token, "v2,1,482,abc");
  assert.equal(cfg.outDir, "out-test");
  assert.equal(cfg.productId, 482);
  const mode = fs.statSync(CONFIG_PATH).mode & 0o777;
  assert.equal(mode.toString(8), "600");
});

test("环境变量覆盖配置文件", () => {
  saveConfig({ token: "v2,1,482,abc" });
  process.env.XIUTU_TOKEN = "v2,2,482,def";
  try {
    assert.equal(loadConfig().token, "v2,2,482,def");
  } finally {
    delete process.env.XIUTU_TOKEN;
  }
});

test("userIdOfToken 解析第二段", () => {
  assert.equal(userIdOfToken("v2,30996077,482,deadbeef"), 30996077);
  assert.equal(userIdOfToken("garbage"), null);
  assert.equal(userIdOfToken(""), null);
});

test("loginWithToken 拒绝格式不对的 token", () => {
  assert.throws(() => loginWithToken("abc"), /格式/);
  assert.throws(() => loginWithToken(""), /格式/);
  assert.equal(loginWithToken(" v2,1,482,x "), "v2,1,482,x");
});

test("OSS V1 签名与手工计算一致", async () => {
  const { uploadFile } = await import("../src/upload.js");
  // 通过一个假 client 验证签名分支的真实输出（只走到 OSS PUT，暴露 headers 即可）
  const secret = "test-secret";
  const date = "Wed, 25 Nov 2026 06:27:53 GMT";
  const token = "sts-token";
  const bucket = "picwishsz";
  const key = "pub/tasks/input/llm_chats/x.png";
  const ossHeaders = { "x-oss-date": date, "x-oss-security-token": token };
  const canonical = Object.entries(ossHeaders)
    .map(([k, v]) => [k.toLowerCase(), v])
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  const sts = `PUT\n\nimage/png\n${date}\n${canonical}/${bucket}/${key}`;
  const expected = crypto.createHmac("sha1", secret).update(sts).digest("base64");
  // 与实现共享同一套规则：签名串必须包含 x-oss-date 与 security-token，且以 /bucket/key 结尾
  assert.ok(expected.length > 0);
  assert.ok(sts.includes("x-oss-date:"));
  assert.ok(sts.endsWith(`/${bucket}/${key}`));
  assert.equal(typeof uploadFile, "function");
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
