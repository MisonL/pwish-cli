import assert from "node:assert/strict";
import test from "node:test";
import { help, TOOLS } from "../src/cli.js";

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return out;
}

test("help 覆盖所有图片工具，不会漏掉新增命令", () => {
  const text = captureStdout(() => help());
  for (const name of Object.keys(TOOLS)) {
    assert.ok(text.includes(`pwish ${name} `), `help 里缺少 ${name}`);
  }
});

test("help 里列出的全局开关与实现一致", () => {
  const text = captureStdout(() => help());
  for (const flag of ["--dry-run", "--quiet", "--force", "--json"]) {
    assert.ok(text.includes(flag), `help 里缺少 ${flag}`);
  }
});
