#!/usr/bin/env node
/**
 * 发布包体积守卫：截图等大文件应该留在仓库里，而不是塞进 npm 包。
 * 超过阈值直接失败，避免以后又把二进制资源加回 files。
 */
import { spawnSync } from "node:child_process";

const LIMIT_KB = Number(process.env.PWISH_PACK_LIMIT_KB || 300);

// npm 把体积信息写到 stderr（npm notice ...），所以两路都要收
const res = spawnSync("npm", ["pack", "--dry-run"], { encoding: "utf8" });
if (res.status !== 0) {
  console.error(`✗ npm pack 失败：${res.stderr || res.error?.message || res.status}`);
  process.exit(1);
}
const out = `${res.stdout || ""}\n${res.stderr || ""}`;

const match = out.match(/package size:\s*([\d.]+)\s*(kB|MB)/);
if (!match) {
  console.error("✗ 无法从 npm pack 输出解析包体积");
  process.exit(1);
}
const kb = Math.round(Number(match[1]) * (match[2] === "MB" ? 1024 : 1));

if (kb > LIMIT_KB) {
  console.error(`✗ 包体积 ${kb} kB 超过上限 ${LIMIT_KB} kB，检查 files 是否混入了大文件`);
  process.exit(1);
}
console.log(`✓ 包体积 ${kb} kB（上限 ${LIMIT_KB} kB）`);
