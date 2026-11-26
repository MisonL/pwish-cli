/** 终端输出层：stdout/stderr 与 ANSI 着色统一从这里走。 */

const tty = Boolean(process.stdout.isTTY);

/** 着色前缀（非 TTY 时为空字符串，保证管道输出干净）。 */
export const cyan = tty ? "\u001b[36m" : "";
export const green = tty ? "\u001b[32m" : "";
export const yellow = tty ? "\u001b[33m" : "";
export const dim = tty ? "\u001b[2m" : "";
export const reset = tty ? "\u001b[0m" : "";

/** 进度/提示 → stderr，不污染可管道化的 stdout。 */
export function log(msg) {
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
