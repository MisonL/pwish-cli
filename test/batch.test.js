import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectInputs } from "../src/cli.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pw-batch-"));
}

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
