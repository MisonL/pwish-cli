/**
 * 文件名与时间戳工具。
 *
 * 结果文件名里会拼进「服务端返回的 scene key」「任务 id」「原始文件名」，
 * 这些内容都不是本地可控的：必须清掉路径分隔符与控制字符，避免写出到目标目录之外。
 */

/** 稳定的本地时间戳片段：`2026-11-27T10-30-00`（macOS/Linux/Windows 都能当文件名）。 */
export function timestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 把任意字符串变成安全的文件名片段：
 * 去掉路径分隔符与 Windows 保留字符、压缩连续点、去掉首尾点和空白、限长。
 */
export function safeName(part, fallback = "image") {
  const cleaned = String(part ?? "")
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .slice(0, 80);

  return cleaned || fallback;
}
