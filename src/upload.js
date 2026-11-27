import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
};

export function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

export function ossV1Signature({ verb, contentMd5 = "", mime, date, ossHeaders, bucket, key, secret }) {
  const canonicalHeaders = Object.entries(ossHeaders)
    .map(([k, v]) => [k.toLowerCase(), v])
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  const stringToSign = `${verb}\n${contentMd5}\n${mime}\n${date}\n${canonicalHeaders}/${bucket}/${key}`;
  return crypto.createHmac("sha1", secret).update(stringToSign).digest("base64");
}

/**
 * 上传本地文件到 picwish 的 OSS，返回 resource_id（后续作为 source_resource_ids 传给生成接口）。
 * 流程：POST authorizations/oss 拿 STS → PUT 到 OSS（带 x-oss-callback，由服务端回调登记资源）。
 */
/**
 * 同一次命令内重复上传同一文件是浪费（套图/详情图很容易把同一张图传两遍）。
 * 这里按「前缀 + 绝对路径 + 大小 + mtime」做进程内记忆，跨进程不复用——
 * resource_id 的有效期由服务端决定，跨进程复用有拿到已失效资源的风险。
 */
const uploadMemo = new Map();

export async function uploadFile(client, file, prefix = "pub/tasks/input/llm_chats") {
  const abs = path.resolve(file);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`不是文件：${abs}`);
  if (stat.size > 20 * 1024 * 1024) throw new Error(`文件超过 20MB：${abs}`);

  const memoKey = `${prefix}|${abs}|${stat.size}|${stat.mtimeMs}`;
  const cached = uploadMemo.get(memoKey);
  if (cached) return cached;

  const pending = performUpload(client, abs, prefix);
  uploadMemo.set(memoKey, pending);
  try {
    return await pending;
  } catch (err) {
    uploadMemo.delete(memoKey); // 失败不缓存，下一次重试仍会真的上传
    throw err;
  }
}

async function performUpload(client, abs, prefix) {
  const name = path.basename(abs);
  const body = fs.readFileSync(abs);
  const mime = mimeOf(abs);

  const auth = await client.request("authorizations/oss", {
    method: "POST",
    body: { filenames: [name], object_prefix: prefix },
  });
  const data = auth.data;
  const key = data.objects?.[name];
  if (!key) throw new Error(`上传授权未返回 object key：${JSON.stringify(data).slice(0, 200)}`);

  const host = `${data.bucket}.${data.endpoint}`;
  if (!/(^|\.)aliyuncs\.com$/i.test(host)) throw new Error(`上传授权返回了意外的 OSS 域名：${host}`);
  const date = new Date().toUTCString();
  const callback = data.callback
    ? Buffer.from(
        JSON.stringify({
          callbackUrl: encodeURI(data.callback.url),
          callbackBody: data.callback.body,
          callbackHost: host,
          callbackBodyType: data.callback.type,
        }),
      ).toString("base64")
    : "";

  const ossHeaders = {
    "x-oss-date": date,
    ...(callback ? { "x-oss-callback": callback } : {}),
    "x-oss-security-token": data.credential.security_token,
  };

  const signature = ossV1Signature({
    verb: "PUT",
    mime,
    date,
    ossHeaders,
    bucket: data.bucket,
    key,
    secret: data.credential.access_key_secret,
  });

  const res = await fetch(`https://${host}/${key}`, {
    signal: AbortSignal.timeout(180_000), // 大图上传可能慢，但必须有上限
    method: "PUT",
    headers: {
      "Content-Type": mime,
      Authorization: `OSS ${data.credential.access_key_id}:${signature}`,
      ...ossHeaders,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OSS 上传失败 HTTP ${res.status}：${text.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`OSS 回调返回非 JSON：${text.slice(0, 200)}`);
  }
  const info = parsed.data || {};
  if (!info.resource_id) throw new Error(`OSS 回调未返回 resource_id：${text.slice(0, 200)}`);
  return { resourceId: info.resource_id, key, url: info.url, width: info.width, height: info.height, name };
}

/** 批量上传：默认 3 路并发，保持返回顺序与入参一致。 */
export async function uploadFiles(client, files, prefix, { concurrency = 3 } = {}) {
  const out = new Array(files.length);
  let cursor = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && cursor < files.length) {
      const index = cursor++;
      try {
        out[index] = await uploadFile(client, files[index], prefix);
      } catch (err) {
        failed = true; // 一张传不上去就别继续烧带宽，让调用方尽早报错
        throw err;
      }
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, files.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}
