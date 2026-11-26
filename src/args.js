import { UserError } from "./config.js";

/** 需要跟一个值的选项（长名与短名都在这里维护）。 */
const VALUE_FLAGS = new Set([
  "model", "m", "ratio", "r", "size", "s", "mode", "format", "f", "n", "out", "o",
  "image", "i", "conv", "conversation", "timeout", "poll", "token", "selling", "site",
  "country", "lang", "scenes", "prompt-file", "limit", "page", "port", "dir",
  "prompt", "p", "mask", "strength", "scale", "type",
]);

/** 纯开关（不需要值）。 */
const BOOLEAN_FLAGS = new Set([
  "json", "no-download", "paste", "help", "no-plan",
  "no-open", "version", "v", "skill", "install", "print", "showpath", "force",
]);

/** 短名 → 长名归一化：让 `-m` 与 `--model` 落到同一个 flag 上。 */
const ALIASES = {
  m: "model",
  r: "ratio",
  s: "size",
  f: "format",
  o: "out",
  i: "image",
  p: "prompt",
};

function canonical(key) {
  return ALIASES[key] || key;
}

/**
 * 解析 argv。返回 { _: 位置参数, flags: 选项表 }。
 * 支持 `--key value`、`--key=value`、`-k value`；`-i` 可重复出现（收集为数组）。
 */
export function parseArgs(argv) {
  const args = { _: [], flags: {} };

  const takeValue = (key, inlineValue, idx) => {
    if (inlineValue !== undefined) return { value: inlineValue, consumed: 0 };
    const next = argv[idx + 1];
    if (next === undefined || (next.startsWith("-") && next !== "-")) {
      throw new UserError(`--${key} 需要一个值`);
    }
    return { value: next, consumed: 1 };
  };

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];

    if (arg === "--") {
      args._.push(...argv.slice(idx + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inline] = arg.slice(2).split("=");
      const key = canonical(rawKey.trim());
      if (inline !== undefined) {
        args.flags[key] = inline;
      } else if (BOOLEAN_FLAGS.has(key)) {
        args.flags[key] = true;
      } else if (VALUE_FLAGS.has(key)) {
        const { value, consumed } = takeValue(key, undefined, idx);
        args.flags[key] = key === "image" ? [...(args.flags.image || []), value] : value;
        idx += consumed;
      } else {
        // 未知长选项按开关处理，保持向前兼容
        args.flags[key] = true;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const key = canonical(arg.slice(1));
      if (VALUE_FLAGS.has(key)) {
        const { value, consumed } = takeValue(key, undefined, idx);
        if (key === "image") args.flags.image = [...(args.flags.image || []), value];
        else args.flags[key] = value;
        idx += consumed;
      } else {
        args.flags[key] = true;
      }
      continue;
    }

    args._.push(arg);
  }

  return args;
}

/** 从 stdin 读取全部内容（非 TTY 时）。 */
export function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
  });
}
