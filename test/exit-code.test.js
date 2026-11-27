import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const BIN = path.join(import.meta.dirname, "..", "bin", "pwish.js");

const homes = [];
process.on("exit", () => {
  for (const dir of homes) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响测试结论 */
    }
  }
});
function runCLI(args, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pw-home-"));
  homes.push(home);
  return spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, "config"), ...env },
    encoding: "utf8",
  });
}

test("未登录时退出码是 3（脚本可据此区分未登录与参数错误）", () => {
  const res = runCLI(["quota"]);
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stderr, /尚未登录/);
});

test("参数错误退出码是 2", () => {
  const res = runCLI(["gen", "x", "-n", "0"]);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /-n 必须是大于 0 的整数/);
});
