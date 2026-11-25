import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 直接从浏览器磁盘上读 localStorage —— 用户只要在浏览器里登录过佐糖，
 * 就不需要复制 token、也不需要点书签（这是「从已登录网页取凭据」的零交互实现）。
 *
 * 原理：Chromium 把 localStorage 存在 <profile>/Local Storage/leveldb 下。
 *  - .ldb 是 SSTable：data block 可能被 snappy 压缩，块尾 5 字节为 [压缩类型][CRC32]
 *  - .log 是 WAL：物理记录 [CRC(4)][len(2)][type(1)][payload]，逻辑记录可能分片
 * 这里只做只读解析，不写原目录，因此可以在浏览器运行中读取（读到的是最新落盘值）。
 *
 * 注意：本模块刻意不实现严格的 key/value 边界解析 —— Chromium 会在 key 末尾附加
 * 内部元数据，跨版本会变。改为在解压后的字节里做定向提取，格式漂移时更抗打。
 */

/** LEB128 varint 解码。返回 { value, next }。 */
export function decodeVarint(buf, pos = 0) {
  let value = 0;
  let shift = 0;
  while (pos < buf.length && shift < 63) {
    const b = buf[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return { value, next: pos };
    shift += 7;
  }
  throw new Error("varint 溢出");
}

/** Snappy 原始块解压。 */
export function snappyDecompress(src) {
  let pos = 0;
  let len = 0;
  let shift = 0;
  while (pos < src.length) {
    const b = src[pos++];
    len += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  if (len === 0 || len > 64 * 1024 * 1024) throw new Error(`snappy 长度非法: ${len}`);
  const out = Buffer.alloc(len);
  let op = 0;
  while (pos < src.length) {
    const tag = src[pos++];
    const type = tag & 0x03;
    let copyLen;
    let offset;
    if (type === 0) {
      copyLen = tag >>> 2;
      if (copyLen >= 60) {
        const n = copyLen - 59;
        copyLen = 0;
        for (let i = 0; i < n; i++) copyLen += src[pos++] * 2 ** (8 * i);
      }
      copyLen += 1;
      if (pos + copyLen > src.length || op + copyLen > len) throw new Error("snappy literal 越界");
      src.copy(out, op, pos, pos + copyLen);
      pos += copyLen;
      op += copyLen;
      continue;
    }
    if (type === 1) {
      copyLen = 4 + ((tag >>> 2) & 0x07);
      offset = ((tag >>> 5) << 8) | src[pos++];
    } else if (type === 2) {
      copyLen = 1 + (tag >>> 2);
      offset = src[pos++] | (src[pos++] << 8);
    } else {
      copyLen = 1 + (tag >>> 2);
      offset = src.readUInt32LE(pos);
      pos += 4;
    }
    if (offset === 0 || offset > op || op + copyLen > len) throw new Error("snappy backref 越界");
    for (let i = 0; i < copyLen; i++) {
      out[op] = out[op - offset];
      op++;
    }
  }
  if (op !== len) throw new Error(`snappy 输出长度不符: ${op} != ${len}`);
  return out;
}

const TABLE_MAGIC = 0xdb4775248b80fb57n;

function readBlockOf(buf, offset, size) {
  const body = buf.slice(offset, offset + size);
  const compression = buf[offset + size];
  if (compression === 0) return body;
  if (compression === 1) return snappyDecompress(body);
  throw new Error(`不支持的 block 压缩类型: ${compression}`);
}

/** 解析 .ldb（SSTable）里所有 data block 的解压内容。 */
export function ldbBlocks(buf) {
  if (buf.length < 48 || buf.readBigUInt64LE(buf.length - 8) !== TABLE_MAGIC) {
    throw new Error("不是 LevelDB .ldb 文件");
  }
  const footer = buf.length - 48;
  const meta = decodeVarint(buf, footer);
  const metaSize = decodeVarint(buf, meta.next);
  const index = decodeVarint(buf, metaSize.next);
  const indexSize = decodeVarint(buf, index.next);

  const blocks = [];
  let indexBlock;
  try {
    indexBlock = readBlockOf(buf, index.value, indexSize.value);
  } catch {
    return blocks;
  }
  const restartCount = indexBlock.readUInt32LE(indexBlock.length - 4);
  const bodyEnd = indexBlock.length - 4 - restartCount * 4;
  let pos = 0;
  let last = Buffer.alloc(0);
  while (pos < bodyEnd) {
    let shared;
    let nonShared;
    let valueLen;
    try {
      shared = decodeVarint(indexBlock, pos);
      nonShared = decodeVarint(indexBlock, shared.next);
      valueLen = decodeVarint(indexBlock, nonShared.next);
    } catch {
      break;
    }
    const keyStart = valueLen.next;
    const key = Buffer.concat([
      last.slice(0, shared.value),
      indexBlock.slice(keyStart, keyStart + nonShared.value),
    ]);
    const valueStart = keyStart + nonShared.value;
    const value = indexBlock.slice(valueStart, valueStart + valueLen.value);
    pos = valueStart + valueLen.value;
    last = key;
    try {
      const offset = decodeVarint(value, 0);
      const size = decodeVarint(value, offset.next);
      blocks.push(readBlockOf(buf, offset.value, size.value));
    } catch {
      /* 跳过坏块 */
    }
  }
  return blocks;
}

/** 解析 .log（WAL）里的记录 payload。 */
export function logBlocks(buf) {
  const out = [];
  let pos = 0;
  let pending = Buffer.alloc(0);
  while (pos + 7 <= buf.length) {
    const length = buf.readUInt16LE(pos + 4);
    const type = buf[pos + 6];
    if (pos + 7 + length > buf.length) break;
    const payload = buf.slice(pos + 7, pos + 7 + length);
    pos += 7 + length;
    if (type === 1) {
      out.push(Buffer.concat([pending, payload]));
      pending = Buffer.alloc(0);
    } else if (type === 2 || type === 3) {
      pending = Buffer.concat([pending, payload]);
    } else if (type === 0) {
      pending = Buffer.alloc(0);
    }
  }
  if (pending.length) out.push(pending);
  return out;
}

/** 把 origin 编码成 Chromium localStorage 的 key 前缀。 */
function originPrefix(origin) {
  return `_${origin}${String.fromCharCode(0)}${String.fromCharCode(1)}`;
}

const PRINTABLE = /^[\x20-\x7e\u00a0-\uffff]*$/;

/**
 * 在一个已解压的 block 里，提取指定 key 之后的值文本。
 * Chromium 在 key 与 value 之间会插入内部元数据，所以取 key 之后的一段窗口，
 * 再从里面挑出「看起来像值」的连续可打印串。
 */
function extractValue(block, keyName, origin) {
  const text = block.toString("latin1");
  const needle = keyName;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx < 0) return null;
    from = idx + needle.length;

    // 确认这个 key 属于目标 origin：向前找最近的 origin 前缀（同一 block 内紧邻）
    const before = text.slice(Math.max(0, idx - 200), idx);
    const prefixAt = before.lastIndexOf(originPrefix(origin));
    const hasOrigin = prefixAt >= 0;

    const window = block.slice(idx + needle.length, idx + needle.length + 512);
    // 值以 0x01 开头（UTF-8 标记）或 UTF-16（字符间夹 0x00）
    for (let i = 0; i < Math.min(window.length, 96); i++) {
      if (window[i] !== 0x01) continue;
      const chunk = window.slice(i + 1);
      // UTF-16LE：第 2 个字节是 0x00
      if (chunk.length > 2 && chunk[1] === 0x00 && chunk[0] !== 0x00) {
        const chars = [];
        for (let j = 0; j + 1 < chunk.length; j += 2) {
          const code = chunk[j] | (chunk[j + 1] << 8);
          if (code === 0) break;
          chars.push(String.fromCharCode(code));
        }
        const s = chars.join("");
        if (s && PRINTABLE.test(s)) return { value: s, hasOrigin };
        continue;
      }
      // UTF-8 / latin1：取到不可打印字符为止
      const bytes = [];
      for (let j = 0; j < chunk.length; j++) {
        const b = chunk[j];
        if (b === 0 || b === 0x1e || b === 0x1d) break;
        bytes.push(b);
      }
      const s = Buffer.from(bytes).toString("utf8");
      if (s && PRINTABLE.test(s)) return { value: s, hasOrigin };
    }
  }
}

/** 读取某 origin 下的所有 localStorage 键值。 */
export function readLocalStorage(dir, origin) {
  const result = {};
  if (!fs.existsSync(dir)) return result;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ldb") || f.endsWith(".log"));
  // 先读 .ldb（旧值），再用 .log（WAL，最新值）覆盖
  files.sort((a, b) => (a.endsWith(".log") ? 1 : 0) - (b.endsWith(".log") ? 1 : 0));

  const wanted = [
    "passport_api_token",
    "passport_user_info",
    "last_login",
    "user_id",
  ];

  for (const file of files) {
    const full = path.join(dir, file);
    let blocks;
    try {
      const buf = fs.readFileSync(full);
      blocks = file.endsWith(".ldb") ? ldbBlocks(buf) : logBlocks(buf);
    } catch {
      continue;
    }
    const joined = Buffer.concat(blocks);
    if (!joined.includes(originPrefix(origin))) continue;

    for (const key of wanted) {
      const found = extractValue(joined, key, origin);
      if (found?.value) result[key] = found.value;
    }

    // 兜底：直接正则捞 token（防止 key 名或结构微调）
    if (!result.passport_api_token) {
      const m = joined.toString("latin1").match(/v2,\d+,\d+,[0-9a-f]{16,}/);
      if (m && joined.includes(originPrefix(origin))) result.passport_api_token = m[0];
    }
  }
  return result;
}

/** 各平台的 Chromium 系浏览器数据根目录。 */
function chromiumRoots() {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [
      ["Chrome", path.join(base, "Google", "Chrome")],
      ["Edge", path.join(base, "Microsoft Edge")],
      ["Brave", path.join(base, "BraveSoftware", "Brave-Browser")],
      ["Chromium", path.join(base, "Chromium")],
      ["Arc", path.join(base, "Arc", "User Data")],
      ["Vivaldi", path.join(base, "Vivaldi")],
    ];
  }

  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      ["Chrome", path.join(local, "Google", "Chrome", "User Data")],
      ["Edge", path.join(local, "Microsoft", "Edge", "User Data")],
      ["Brave", path.join(local, "BraveSoftware", "Brave-Browser", "User Data")],
      ["Chromium", path.join(local, "Chromium", "User Data")],
      ["Vivaldi", path.join(local, "Vivaldi", "User Data")],
    ];
  }

  // Linux 及其他：XDG
  const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    ["Chrome", path.join(config, "google-chrome")],
    ["Chrome Beta", path.join(config, "google-chrome-beta")],
    ["Chromium", path.join(config, "chromium")],
    ["Edge", path.join(config, "microsoft-edge")],
    ["Brave", path.join(config, "BraveSoftware", "Brave-Browser")],
    ["Vivaldi", path.join(config, "vivaldi")],
  ];
}

/** 常见 Chromium 浏览器的 Local Storage leveldb 目录（macOS / Windows / Linux）。 */
export function browserProfiles() {
  const found = [];

  const add = (browser, profile) => {
    const leveldb = path.join(profile, "Local Storage", "leveldb");
    if (fs.existsSync(leveldb)) found.push({ browser, profile, leveldb });
  };

  for (const [browser, root] of chromiumRoots()) {
    if (!fs.existsSync(root)) continue;
    add(browser, path.join(root, "Default"));
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (d.isDirectory() && /^Profile \d+$/.test(d.name)) add(browser, path.join(root, d.name));
      }
    } catch {
      /* 无权限或不可读时跳过 */
    }
  }

  return found;
}

/** 扫描所有 profile，返回所有找到的 picwish token。 */
export function findPassportToken(origin = "https://picwish.cn") {
  const hits = [];
  for (const p of browserProfiles()) {
    let storage;
    try {
      storage = readLocalStorage(p.leveldb, origin);
    } catch {
      continue;
    }
    const token = (storage.passport_api_token || "").trim();
    if (token) hits.push({ browser: p.browser, profile: p.profile, token, storage });
  }
  return hits;
}
