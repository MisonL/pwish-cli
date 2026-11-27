import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pwish-test-"));
process.env.PWISH_CONFIG_DIR = tmpDir;

const { loadConfig, saveConfig, userIdOfToken, resolveToken, UserError, CONFIG_PATH } = await import("../src/config.js");
const { loginWithToken } = await import("../src/api.js");

test("没有 token 时 resolveToken 抛 NO_TOKEN", () => {
  saveConfig({ token: "" });
  assert.throws(() => resolveToken(loadConfig()), (err) => err instanceof UserError && err.code === "NO_TOKEN");
});

test("saveConfig/loadConfig 往返，且文件权限 0600", () => {
  saveConfig({ token: "v2,10000003,482,abc", outDir: "out-test" });
  const cfg = loadConfig();
  assert.equal(cfg.token, "v2,10000003,482,abc");
  assert.equal(cfg.outDir, "out-test");
  assert.equal(cfg.productId, 482);
  const mode = fs.statSync(CONFIG_PATH).mode & 0o777;
  assert.equal(mode.toString(8), "600");
});

test("环境变量覆盖配置文件", () => {
  saveConfig({ token: "v2,10000003,482,abc" });
  process.env.PWISH_TOKEN = "v2,10000002,482,def";
  try {
    assert.equal(loadConfig().token, "v2,10000002,482,def");
  } finally {
    delete process.env.PWISH_TOKEN;
  }
});

test("userIdOfToken 解析第二段", () => {
  assert.equal(userIdOfToken("v2,10000001,482,deadbeef"), 10000001);
  assert.equal(userIdOfToken("garbage"), null);
  assert.equal(userIdOfToken(""), null);
});

test("loginWithToken 拒绝格式不对的 token", () => {
  assert.throws(() => loginWithToken("abc"), /格式/);
  assert.throws(() => loginWithToken(""), /格式/);
  assert.equal(loginWithToken(" v2,10000003,482,x "), "v2,10000003,482,x");
});

test("OSS V1 签名用生产函数算，且与手工推导的规范串一致", async () => {
  const { ossV1Signature } = await import("../src/upload.js");
  const secret = "test-secret";
  const date = "Wed, 25 Nov 2026 06:27:53 GMT";
  const token = "sts-token";
  const bucket = "picwishsz";
  const key = "pub/tasks/input/llm_chats/x.png";
  const ossHeaders = { "X-Oss-Date": date, "x-oss-security-token": token }; // 大小写混写，验证归一

  const signature = ossV1Signature({
    verb: "PUT",
    mime: "image/png",
    date,
    ossHeaders,
    bucket,
    key,
    secret,
  });

  const canonical = "x-oss-date:" + date + "\n" + "x-oss-security-token:" + token + "\n";
  const sts = `PUT\n\nimage/png\n${date}\n${canonical}/${bucket}/${key}`;
  const expected = crypto.createHmac("sha1", secret).update(sts).digest("base64");

  assert.equal(signature, expected);
});


test("损坏的配置文件给出明确错误", async () => {
  const { loadConfig } = await import("../src/config.js");
  fs.writeFileSync(CONFIG_PATH, "{not json", { mode: 0o600 });
  assert.throws(() => loadConfig(), (err) => err instanceof UserError && err.code === "BAD_CONFIG");
  fs.rmSync(CONFIG_PATH);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
