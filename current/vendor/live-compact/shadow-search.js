// 在 spine 的会话备份目录里检索原文片段。
//
// 背景：压缩把长段原文从上下文里移出、落到 shadow 目录，上下文只留摘要。
// 摘要容易丢掉具体坐标（文件路径、commit 短哈希、参数名），事后要把它们找回来时，
// 目前只能靠外部工具手敲 grep —— 而目录布局与文件命名是插件自己的约定，外部工具只能猜。
//
// 目录约定（1.0.6 起）：备份按会话分目录，`sessionDir(root, key)` 给出某个会话的目录。
// 本模块**只读传入的那一个目录**，不递归、不跨会话、不推导路径；
// 需要「当前会话」语义时，调用方用 `root + sessionKey` 组合，由本模块调 `sessionDir` 定位。
//
// 设计取向（低耦合）：
//   · 目录一律由调用方给出（`dir`，或 `root` + `sessionKey`）
//   · 文件识别复用本包已有的 `listPluginShadows`：哪些文件算备份、怎么命名，
//     由插件自己维护（本模块不另立一套过滤规则）
//   · 返回值是纯数据，不含句柄、不读环境变量、不碰全局状态

import { resolve } from "node:path";
import { listPluginShadows, readPrivateFile, readRegularFile, sessionDir } from "./shadow.js";
import { contentHash, PRUNE_MARKER, rawName } from "./raw.js";

/** 单文件默认上限：超过就跳过，避免一次把几百 MB 读进内存。 */
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
/** 默认最多返回多少条命中。 */
const DEFAULT_LIMIT = 50;
/** 备份文件首行是 `# spine-session <key>`：它是元信息，不参与匹配。 */
const SESSION_HEADER = /^# spine-session (\S+)\s*$/;

// Keep the first actual match visible, including room for adjacent values. The
// 400 UTF-16 character budget includes explicit ellipses on truncated sides.
function matchExcerpt(line, offset, length) {
  if (line.length <= 400) return line;
  const budget = 398;
  const start = Math.min(Math.max(0, offset - Math.floor((budget - Math.min(length, budget)) / 2)), line.length - budget);
  const end = start + budget;
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

// Case folding can expand characters (for example İ -> i + combining dot), so
// an index in the folded text is not always the original line's offset.
function unfoldedOffset(line, offset) {
  let original = 0;
  let folded = 0;
  for (const character of line) {
    const width = character.toLowerCase().length;
    if (folded + width > offset) break;
    folded += width;
    original += character.length;
  }
  return original;
}

/**
 * 在一个会话备份目录里检索文本。
 *
 * 目录只有两种给法，二选一：
 *   · `dir` —— 直接给会话备份目录（例如 `sessionDir(shadowRoot, key)` 的结果）
 *   · `root` + `sessionKey` —— 给 shadow 根和会话键，本模块按 `sessionDir` 定位到该会话目录
 * 无论哪种，都**只扫描那一个目录**：不递归子目录、不扫父目录、不跨会话。
 * 长行返回首次命中附近最多 400 字符的摘录，省略一侧时显示 …；短行和原行号保持不变。
 *
 * @param {object} options 参数对象
 * @param {string} [options.dir] 会话备份目录（与 root+sessionKey 二选一）
 * @param {string} [options.root] shadow 根目录（配合 sessionKey 使用）
 * @param {string} [options.sessionKey] 会话键（配合 root 使用）
 * @param {string} options.pattern 关键词；`regex: true` 时按正则解释
 * @param {boolean} [options.regex=false] 把 pattern 当正则
 * @param {boolean} [options.ignoreCase=false] 忽略大小写
 * @param {number} [options.limit=50] 最多返回多少条命中
 * @param {number} [options.maxFileBytes=8388608] 单文件大小上限，超过则跳过
 * @returns {{directory: string, scanned: number, skipped: number, matchedFiles: number, truncated: boolean, matches: Array<{file: string, sessionKey: string, line: number, text: string}>}}
 * @throws {TypeError} 目录参数缺失、或 pattern 缺失时抛出
 */
export function searchShadow(options = {}) {
  const directory = resolveTargetDirectory(options);
  const pattern = options.pattern;
  if (typeof pattern !== "string" || pattern === "") {
    throw new TypeError("searchShadow: pattern is required (a keyword, or a regular expression when regex is true)");
  }
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;
  const maxFileBytes = Number.isFinite(options.maxFileBytes) && options.maxFileBytes > 0
    ? Math.floor(options.maxFileBytes)
    : DEFAULT_MAX_FILE_BYTES;
  const matcher = options.regex === true
    ? new RegExp(pattern, options.ignoreCase === true ? "i" : "")
    : null;
  const needle = options.ignoreCase === true ? pattern.toLowerCase() : pattern;

  const matches = [];
  let scanned = 0;
  let skipped = 0;
  let matchedFiles = 0;
  let truncated = false;

  // 只列这一层：listPluginShadows 内部就是一次 readdir + 只收符合命名的普通文件，
  // 因此天然不会递归进别的会话目录。
  for (const file of listPluginShadows(directory)) {
    if (file.size > maxFileBytes) {
      skipped += 1;
      continue;
    }
    let text;
    try {
      const body = file.name.startsWith("raw-")
        ? readPrivateFile(file.path, maxFileBytes)
        : readRegularFile(file.path, maxFileBytes);
      if (file.name.startsWith("raw-")) {
        const meta = JSON.parse(readPrivateFile(`${file.path}.meta.json`, 65536).toString("utf8"));
        if (rawName(meta.toolCallId) !== file.name || meta.bytes !== body.length || meta.sha256 !== contentHash(body) || body.includes(PRUNE_MARKER)) throw new Error("incomplete raw backup");
      }
      text = body.toString("utf8");
    } catch {
      skipped += 1;
      continue;
    }
    scanned += 1;
    let hitThisFile = false;
    const lines = text.split("\n");
    const headerMatch = SESSION_HEADER.exec(lines[0] ?? "");
    const sessionKey = headerMatch === null ? file.sessionKey : headerMatch[1];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (SESSION_HEADER.test(line)) continue;
      let offset;
      let matchLength;
      if (matcher === null) {
        const folded = options.ignoreCase === true ? line.toLowerCase() : line;
        offset = folded.indexOf(needle);
        if (offset >= 0 && folded.length !== line.length) offset = unfoldedOffset(line, offset);
        matchLength = pattern.length;
      } else {
        const hit = matcher.exec(line);
        offset = hit?.index ?? -1;
        matchLength = hit?.[0].length ?? 0;
      }
      if (offset < 0) continue;
      hitThisFile = true;
      matches.push({
        file: file.path,
        sessionKey,
        line: index + 1,
        text: matchExcerpt(line, offset, matchLength),
      });
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
    }
    if (hitThisFile) matchedFiles += 1;
    if (truncated) break;
  }

  return { directory, scanned, skipped, matchedFiles, truncated, matches };
}

/**
 * 解析出「要扫描的那一个目录」。
 *
 * 这里刻意不接受「只给 root」：那会让调用方以为在搜全部会话，
 * 而实际需求永远只针对某个会话。
 *
 * @param {object} options searchShadow 的入参
 * @returns {string} 会话备份目录的绝对路径
 * @throws {TypeError} 没有给出可用的目录参数时
 */
function resolveTargetDirectory(options) {
  if (typeof options.dir === "string" && options.dir !== "") return resolve(options.dir);
  if (typeof options.root === "string" && options.root !== "" && typeof options.sessionKey === "string" && options.sessionKey !== "") {
    return resolve(sessionDir(options.root, options.sessionKey));
  }
  throw new TypeError(
    "searchShadow: pass either dir (a session backup directory) or root + sessionKey; "
    + "searching a whole shadow root is not supported on purpose",
  );
}

