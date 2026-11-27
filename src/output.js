/** 终端输出层：stdout/stderr 与 ANSI 着色统一从这里走。 */

// 颜色策略：NO_COLOR 一律关（de facto 标准）；FORCE_COLOR 强制开（CI 里看日志）；
// 默认看 stdout 是不是终端，管道/重定向时不出转义码。
const colorEnv = process.env.NO_COLOR ? "never" : process.env.FORCE_COLOR ? "always" : "auto";
const tty = colorEnv === "always" || (colorEnv === "auto" && Boolean(process.stdout.isTTY));

/** 着色前缀（非 TTY 时为空字符串，保证管道输出干净）。 */
export const cyan = tty ? "\u001b[36m" : "";
export const green = tty ? "\u001b[32m" : "";
export const yellow = tty ? "\u001b[33m" : "";
export const dim = tty ? "\u001b[2m" : "";
export const reset = tty ? "\u001b[0m" : "";

let quiet = false;

/** 静默模式：只保留结果行，进度/提示全部丢弃（脚本调用时用）。 */
export function setQuiet(value) {
  quiet = Boolean(value);
}

/** 进度/提示 → stderr，不污染可管道化的 stdout。 */
export function log(msg) {
  if (quiet) return;
  process.stderr.write(`${msg}\n`);
}

/** 结果 → stdout。 */
export function say(msg) {
  process.stdout.write(`${msg}\n`);
}

/** 机器可读输出。 */
export function json(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}
