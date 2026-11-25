#!/usr/bin/env node
/**
 * 零依赖自检：语法、未使用 import、硬编码凭证、stdout/stderr 卫生。
 * 用法：node scripts/check.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIRS = ["src", "bin", "scripts"];
const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

const files = SRC_DIRS.flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(d) : []));

for (const file of files) {
  const abs = path.join(ROOT, file);
  const source = fs.readFileSync(abs, "utf8");

  // 1. 语法
  try {
    execFileSync(process.execPath, ["--check", abs], { stdio: "pipe" });
  } catch (err) {
    problems.push(`${file}: 语法错误\n${err.stderr?.toString().split("\n")[0] ?? err.message}`);
    continue;
  }

  // 2. 未使用的 import
  const importRe = /import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+["'][^"']+["']/g;
  for (const m of source.matchAll(importRe)) {
    const names = m[1]
      ? m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean)
      : [m[2]];
    const rest = source.slice(m.index + m[0].length);
    for (const name of names) {
      if (!new RegExp(`\\b${name}\\b`).test(rest)) problems.push(`${file}: 未使用的 import 「${name}」`);
    }
  }

  // 3. 硬编码凭证（v2,<uid>,<pid>,<hex>）
  const secret = source.match(/v2,\d{5,},\d+,[0-9a-f]{16,}/);
  if (secret) problems.push(`${file}: 疑似硬编码 token「${secret[0].slice(0, 12)}…」`);

  // 4. 直接用 console.* 而非 output 层（脚本与 bin 除外）
  if (file.startsWith("src/") && file !== "src/output.js") {
    if (/\bconsole\.(log|info)\b/.test(source)) problems.push(`${file}: 请用 output.js 而非 console.log`);
  }

  // 5. FIXME/XXX 遗留（跳过自检脚本自身，它包含这些字面量）
  if (file !== "scripts/check.js") {
    const marker = source.match(/\b(FIXME|XXX)\b/);
    if (marker) problems.push(`${file}: 遗留 ${marker[1]}`);
  }
}

if (problems.length) {
  console.error(`✗ 自检失败（${problems.length} 项）`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✓ 自检通过（${files.length} 个文件）`);
