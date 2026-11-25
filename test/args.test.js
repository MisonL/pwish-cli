import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs } from "../src/args.js";

test("位置参数与长选项", () => {
  const a = parseArgs(["gen", "白底商品图", "--model", "gemini-3", "--ratio=1:1", "--json"]);
  assert.deepEqual(a._, ["gen", "白底商品图"]);
  assert.equal(a.flags.model, "gemini-3");
  assert.equal(a.flags.ratio, "1:1");
  assert.equal(a.flags.json, true);
});

test("短选项：-i 可重复并收集为数组", () => {
  const a = parseArgs(["suite", "-i", "a.jpg", "-i", "b.jpg", "-m", "gpt-image-2", "-n", "2"]);
  assert.deepEqual(a.flags.image, ["a.jpg", "b.jpg"]);
  assert.equal(a.flags.model, "gpt-image-2");
  assert.equal(a.flags.n, "2");
});

test("-- 之后的内容全部作为位置参数", () => {
  const a = parseArgs(["gen", "--", "--not-a-flag", "-x"]);
  assert.deepEqual(a._, ["gen", "--not-a-flag", "-x"]);
});

test("缺少值时抛 UserError", () => {
  assert.throws(() => parseArgs(["gen", "--model"]), /需要一个值/);
  assert.throws(() => parseArgs(["gen", "-i", "--json"]), /需要一个值/);
});

test("负数值需要显式内联写法，避免被误判为选项", () => {
  // `-n -1` 会被当作「缺少值」而报错——数量为负本就无意义，这是期望行为
  assert.throws(() => parseArgs(["gen", "-n", "-1"]), /需要一个值/);
  // 真正需要负值时用 `--key=value`
  assert.equal(parseArgs(["gen", "--n=-1"]).flags.n, "-1");
});

test("CLI --version 输出版本号", () => {
  const bin = fileURLToPath(new URL("../bin/pwish.js", import.meta.url));
  const r = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^pwish \d+\.\d+\.\d+$/);
});

test("skill 相关 flag 解析正确", () => {
  const a = parseArgs(["skill", "--install", "--dir", "/tmp/skills"]);
  assert.equal(a.flags.install, true);
  assert.equal(a.flags.dir, "/tmp/skills");
});

test("CLI skill --install 复制内置 skill 到指定目录", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");

  const bin = fileURLToPath(new URL("../bin/pwish.js", import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pwish-skill-"));
  const r = spawnSync(process.execPath, [bin, "skill", "--install", "--dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0);
  const installed = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  assert.match(installed, /^---\nname: pwish/m);
  fs.rmSync(dir, { recursive: true, force: true });
});
