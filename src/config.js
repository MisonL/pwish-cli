import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const CONFIG_DIR = process.env.PWISH_CONFIG_DIR || path.join(HOME, ".config", "pwish");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  apiBase: "https://aw.aoscdn.com/app/picwish",
  productId: 482,
  language: "zh",
  token: "",
  outDir: "out",
};

export function loadConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("格式不正确");
    } catch (err) {
      throw new UserError(
        `配置文件损坏：${CONFIG_PATH}（${err.message}）。请删除该文件后重新执行 pwish login。`,
        "BAD_CONFIG",
      );
    }
  }
  const cfg = { ...DEFAULTS, ...file };
  if (process.env.PWISH_TOKEN) cfg.token = process.env.PWISH_TOKEN;
  if (process.env.PWISH_API_BASE) cfg.apiBase = process.env.PWISH_API_BASE;
  if (process.env.PWISH_OUT) cfg.outDir = process.env.PWISH_OUT;
  return cfg;
}

export function saveConfig(patch) {
  // 只合并磁盘上的内容 + 本次 patch：环境变量（PWISH_TOKEN 等）属于临时覆盖，
  // 不能被写进配置文件，否则一次 CI 运行就会把临时 token 固化下来。
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) file = parsed;
    } catch {
      file = {}; // 损坏时按空配置重写，loadConfig 已经负责报错提示
    }
  }
  const next = { ...DEFAULTS, ...file, ...patch };
  delete next.tokenFix;
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // 先在内存里限制权限，避免 0644 的窗口期
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort on exotic filesystems */
  }
  return next;
}

/** passport token 形如 `v2,<user_id>,482,<secret>`；第二段是 user_id。 */
export function userIdOfToken(token) {
  const parts = String(token || "").split(",");
  const id = Number(parts[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function resolveToken(cfg) {
  const token = (cfg?.token || "").trim();
  if (!token) {
    throw new UserError(
      "尚未登录。先执行 `pwish login`，或设置环境变量 PWISH_TOKEN。",
      "NO_TOKEN",
    );
  }
  return token;
}

export class UserError extends Error {
  constructor(message, code = "USER_ERROR", hint = "") {
    super(message);
    this.name = "UserError";
    this.code = code;
    this.hint = hint;
  }
}

/** Parse `passport_user_info` JSON (optional, only for display). */
export function readCachedUser() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "user.json"), "utf8"));
    return raw;
  } catch {
    return null;
  }
}

export function writeCachedUser(user) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(CONFIG_DIR, "user.json"), `${JSON.stringify(user, null, 2)}\n`, { mode: 0o600 });
}
