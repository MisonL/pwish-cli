import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectInputs } from "../src/cli.js";

const dirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-batch-"));
  dirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }
});

test("collectInputs 只挑图片，按文件名排序", () => {
  const dir = tmpDir();
  for (const name of ["b.png", "a.JPG", "c.webp", "note.txt", "data.json"]) {
    fs.writeFileSync(path.join(dir, name), "x");
  }
  const files = collectInputs([dir]).map((f) => path.basename(f));
  assert.deepEqual(files, ["a.JPG", "b.png", "c.webp"]);
});

test("collectInputs 保留显式传入的文件，忽略扩展名判断", () => {
  const dir = tmpDir();
  const weird = path.join(dir, "raw.bin");
  fs.writeFileSync(weird, "x");
  assert.deepEqual(collectInputs([weird]), [weird]);
});

test("collectInputs 对不存在的路径抛出可读错误", () => {
  assert.throws(() => collectInputs([path.join(os.tmpdir(), "definitely-missing-xyz")]), /路径不存在/);
});

test("collectInputs 空目录返回空数组", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "readme.txt"), "x");
  assert.deepEqual(collectInputs([dir]), []);
});

test("isQuotaExhausted 只在额度类错误上返回 true", async () => {
  const { isQuotaExhausted } = await import("../src/cli.js");
  for (const code of ["QUOTA_EXCEEDED", "CREDIT_NOT_ENOUGH", "DAILY_LIMIT_EXCEEDED", "FREE_PREVIEW_LIMIT_EXCEEDED"]) {
    assert.equal(isQuotaExhausted({ code }), true, code);
  }
  assert.equal(isQuotaExhausted({ code: "NETWORK_ERROR" }), false);
  assert.equal(isQuotaExhausted(new Error("boom")), false);
  assert.equal(isQuotaExhausted(null), false);
});
