#!/usr/bin/env node
/** 零依赖格式检查：缩进、行尾空白、末尾换行、行宽提醒。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function walk(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

const files = ["src", "bin", "test", "scripts"].flatMap((d) => {
  const dir = path.join(ROOT, d);
  return fs.existsSync(dir) ? walk(d, [".js"]) : [];
});
files.push("package.json", "README.md", "CHANGELOG.md", "LICENSE");

for (const file of files) {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");

  if (text.includes("\r\n")) problems.push(`${file}: 含 CRLF 行尾，应为 LF`);
  if (!text.endsWith("\n")) problems.push(`${file}: 缺少末尾换行`);
  for (let i = 0; i < lines.length; i++) {
    if (/\s+$/.test(lines[i]) && i < lines.length - 1) problems.push(`${file}:${i + 1}: 行尾空白`);
    if (/^\t/.test(lines[i])) problems.push(`${file}:${i + 1}: 缩进应为空格而非 tab`);
  }
}

if (problems.length) {
  console.error(`✗ 格式检查失败（${problems.length} 项）`);
  problems.slice(0, 40).forEach((p) => console.error(`  - ${p}`));
  if (problems.length > 40) console.error(`  ... 另有 ${problems.length - 40} 项`);
  process.exit(1);
}
console.log(`✓ 格式检查通过（${files.length} 个文件）`);
