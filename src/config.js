import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
export const CONFIG_DIR = process.env.PWISH_CONFIG_DIR || path.join(HOME, ".config", "pwish");
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
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    file = {};
  }
  const cfg = { ...DEFAULTS, ...file };
  if (process.env.PWISH_TOKEN) cfg.token = process.env.PWISH_TOKEN;
  if (process.env.PWISH_API_BASE) cfg.apiBase = process.env.PWISH_API_BASE;
  if (process.env.PWISH_OUT) cfg.outDir = process.env.PWISH_OUT;
  return cfg;
}

export function saveConfig(patch) {
  const current = loadConfig();
  const next = { ...current, ...patch };
  delete next.tokenFix;
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort on exotic filesystems */
  }
  return next;
}

/** passport token 形如 `v2,30996077,482,xxxx`；第二段是 user_id。 */
export function userIdOfToken(token) {
  const parts = String(token || "").split(",");
  const id = Number(parts[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function resolveToken(cfg) {
  const token = (cfg?.token || "").trim();
  if (!token) {
    throw new UserError(
      "尚未登录。先执行 `pwish login` 粘贴浏览器里的 passport_api_token，或设置环境变量 PWISH_TOKEN。",
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
