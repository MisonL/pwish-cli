import { UserError } from "./config.js";

/** 需要跟一个值的选项（长名与短名都在这里维护）。 */
const VALUE_FLAGS = new Set([
  "model", "m", "ratio", "r", "size", "s", "mode", "format", "f", "n", "out", "o",
  "image", "i", "conv", "conversation", "timeout", "poll", "token", "selling", "site",
  "country", "lang", "scenes", "prompt-file", "limit", "page", "port", "dir",
  "prompt", "p", "mask", "strength", "scale", "type", "to", "from", "left", "right", "top", "bottom",
  "concurrency",
]);

/** 纯开关（不需要值）。 */
const BOOLEAN_FLAGS = new Set([
  "json", "no-download", "help", "no-plan",
  "no-open", "version", "v", "skill", "install", "print", "showpath", "force", "quiet", "dry-run",
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
/** 布尔值归一：--force=false / --force=0 视为关闭，避免字符串 "false" 被当成真。 */
function toBool(raw) {
  const v = String(raw).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(v)) return false;
  if (["true", "1", "yes", "on"].includes(v)) return true;
  throw new UserError(`开关选项只接受 true/false，收到：${raw}`);
}

/** -i/--image 可重复：统一收成数组，且不会把已有字符串拆成字符。 */
function pushImage(flags, value) {
  const prev = flags.image;
  if (prev === undefined) flags.image = [value];
  else if (Array.isArray(prev)) flags.image = [...prev, value];
  else flags.image = [prev, value];
}

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
      const eq = arg.indexOf("=");
      const rawKey = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const key = canonical(rawKey.trim());
      if (inline !== undefined && BOOLEAN_FLAGS.has(key)) {
        args.flags[key] = toBool(inline);
      } else if (inline !== undefined) {
        if (key === "image") pushImage(args.flags, inline);
        else args.flags[key] = inline;
      } else if (BOOLEAN_FLAGS.has(key)) {
        args.flags[key] = true;
      } else if (VALUE_FLAGS.has(key)) {
        const { value, consumed } = takeValue(key, undefined, idx);
        if (key === "image") pushImage(args.flags, value);
        else args.flags[key] = value;
        idx += consumed;
      } else {
        // 拼错的选项必须报错：否则 --dryrun 会静默变成真跑，可能白扣额度
        throw new UserError(`未知选项 --${rawKey}。用 pwish help 查看支持的选项`, "UNKNOWN_FLAG");
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const key = canonical(arg.slice(1));
      if (VALUE_FLAGS.has(key)) {
        const { value, consumed } = takeValue(key, undefined, idx);
        if (key === "image") pushImage(args.flags, value);
        else args.flags[key] = value;
        idx += consumed;
      } else if (BOOLEAN_FLAGS.has(key)) {
        args.flags[key] = true;
      } else {
        throw new UserError(`未知选项 -${arg.slice(1)}。用 pwish help 查看支持的选项`, "UNKNOWN_FLAG");
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
