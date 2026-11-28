/**
 * 下载结果的轻量内容校验。
 *
 * 场景：OSS / CDN 在签名过期、对象不存在时可能返回 **HTTP 200 + XML/JSON 错误体**，
 * 直接落盘会得到一个几百字节的「假图片」。这里只做魔数检查（不解码、不引依赖），
 * 拦住明显的非图片响应。
 */

const MAGIC = [
  { ext: ".png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ".jpg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".webp", bytes: [0x52, 0x49, 0x46, 0x46] /* RIFF....WEBP */, webp: true },
  { ext: ".gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ".bmp", bytes: [0x42, 0x4d] },
];

/** 返回识别到的扩展名；不是已知图片时返回 null。 */
export function sniffImageExt(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  for (const spec of MAGIC) {
    let ok = true;
    for (let i = 0; i < spec.bytes.length; i += 1) {
      if (buf[i] !== spec.bytes[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (spec.webp) {
      if (buf.slice(8, 12).toString("ascii") !== "WEBP") continue;
    }
    return spec.ext;
  }
  return null;
}

/** 预检：明显不是图片时抛错，避免把错误体写成 .png/.jpg。 */
export function assertImageBytes(buf, url = "") {
  const ext = sniffImageExt(buf);
  if (ext) return ext;
  const head = buf?.subarray?.(0, 80)?.toString("utf8").replace(/\s+/g, " ").trim() || "";
  throw new Error(`下载结果不是图片（${buf?.length ?? 0} 字节${head ? `，开头：${head.slice(0, 60)}` : ""}）：${url.slice(0, 100)}`);
}
