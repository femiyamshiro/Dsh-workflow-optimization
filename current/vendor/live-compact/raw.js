/**
 * 工具原文。按 toolCallId 只写一次，写在官方修剪器换掉表面文本之前。
 * Raw tool text, written once per toolCallId, before the official pruner replaces the surface.
 *
 * 已有文件必须对得上首次 meta 的哈希。对不上就当没有完整备份，不用当前内容给自己重算信任。
 * An existing file must match the first meta hash. A mismatch is not a backup.
 */
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { readPrivateFile, withShadowStore } from "./shadow.js";

export const PRUNE_MARKER = "[... tool result middle pruned ...]";

export function contentHash(text) {
  const hash = createHash("sha256");
  hash.update(typeof text === "string" ? Buffer.from(text, "utf8") : text);
  return hash.digest("hex");
}

export function rawName(toolCallId) {
  return `raw-${createHash("sha256").update(String(toolCallId)).digest("hex").slice(0, 16)}.txt`;
}

function readExisting(file, toolCallId, includeText = false) {
  let meta;
  try {
    meta = JSON.parse(readPrivateFile(`${file}.meta.json`, 65536).toString("utf8"));
  } catch {
    return { ok: false, reason: "missing-meta", toolCallId };
  }
  if (meta?.toolCallId !== toolCallId || !/^[0-9a-f]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.bytes) || meta.bytes < 0) {
    return { ok: false, reason: "bad-meta", toolCallId };
  }
  let stored;
  try {
    stored = readPrivateFile(file);
  } catch {
    return { ok: false, reason: "missing-file", toolCallId };
  }
  if (stored.length !== meta.bytes || contentHash(stored) !== meta.sha256 || stored.includes(PRUNE_MARKER)) {
    return { ok: false, reason: "hash-mismatch", toolCallId };
  }
  return {
    ok: true,
    existed: true,
    path: file,
    bytes: stored.length,
    sha256: meta.sha256,
    toolCallId,
    label: meta.label || "",
    ...(includeText ? { text: stored.toString("utf8") } : {}),
  };
}

export function verifiedRaw(record, readFile = readPrivateFile) {
  const id = record?.toolCallId || "";
  if (!record?.ok || !record.path || !record.sha256 || !id) return { ok: false, toolCallId: id };
  const existing = readExisting(record.path, id, readFile === readPrivateFile);
  if (!existing.ok || existing.bytes !== record.bytes || existing.sha256 !== record.sha256) return { ok: false, toolCallId: id };
  if (readFile === readPrivateFile) {
    return { ok: true, text: existing.text, toolCallId: id, path: record.path, sha256: existing.sha256, bytes: existing.bytes, label: existing.label };
  }
  let stored;
  try {
    stored = readFile(record.path);
  } catch {
    return { ok: false, toolCallId: id };
  }
  const bytes = typeof stored === "string" ? Buffer.from(stored, "utf8") : stored;
  const text = typeof stored === "string" ? stored : stored.toString("utf8");
  if (contentHash(bytes) !== record.sha256 || bytes.length !== record.bytes || text.includes(PRUNE_MARKER)) {
    return { ok: false, toolCallId: id };
  }
  return {
    ok: true,
    text,
    toolCallId: id,
    path: record.path,
    sha256: record.sha256,
    bytes: bytes.length,
    label: record.label || "",
  };
}

export function rawExcerptText(surface, record) {
  const checked = record?.ok ? verifiedRaw(record) : null;
  if (checked?.ok) return { text: checked.text, raw: checked };
  const surfaceText = String(surface ?? "");
  const id = record?.toolCallId || "";
  if (record && surfaceText.includes(PRUNE_MARKER)) return { text: "", raw: id ? { ok: false, toolCallId: id } : undefined };
  if (record) return { text: surfaceText, raw: { ok: false, toolCallId: id } };
  return { text: surfaceText, raw: undefined };
}

// 同一个 toolCallId 只写一次。文件已在就核验 meta，不覆盖。
// 正文已经带修剪标记、又没有旧文件时，不把修剪后的文本当成原文。
// Write once per toolCallId. An existing file is verified, never overwritten.
// Pruned text with no earlier file is not stored as the original.
export function captureToolResult({ dir, root = dir, toolCallId, text, turn, name, pathLabel, ownerPid = process.pid }) {
  if (!toolCallId) return { ok: false, reason: "missing-id", toolCallId: "" };
  const body = String(text ?? "");
  const file = join(resolve(dir), rawName(toolCallId));
  const result = withShadowStore({ root, dir, ownerPid }, ({ write, used, cap }) => {
    const existing = readExisting(file, toolCallId);
    if (existing.ok) return existing;
    // Missing/bad metadata on an existing body must not be repaired by trusting
    // today's surface text. Exclusive publication will preserve existing files.
    if (body.includes(PRUNE_MARKER)) return { ok: false, reason: "already-pruned", toolCallId };
    if (Buffer.byteLength(body, "utf8") > cap - used) return { ok: false, reason: "storage-full", used, cap };
    const bytes = Buffer.from(body, "utf8");
    const hash = contentHash(bytes);
    const metadata = JSON.stringify({
        toolCallId,
        bytes: bytes.length,
        sha256: hash,
        turn: turn ?? null,
        name: name || "",
        label: pathLabel || "",
      });
    if (Buffer.byteLength(metadata) > 65536) return { ok: false, reason: "metadata-too-large", toolCallId };
    const saved = write([{ name: rawName(toolCallId), body: bytes }, { name: `${rawName(toolCallId)}.meta.json`, body: metadata }]);
    if (!saved.ok) return saved;
    const checked = readExisting(file, toolCallId);
    return checked.ok ? { ...checked, existed: false } : checked;
  });
  return { ...result, toolCallId };
}

export function pointerFor(record, readFile = readPrivateFile) {
  const id = record?.toolCallId || "";
  if (!id) return "";
  const checked = record?.ok ? verifiedRaw(record, readFile) : null;
  if (!checked?.ok) return `无完整备份 [${id}]`;
  const label = checked.label ? `${checked.label} ` : "";
  return `${label}原文 ${checked.path} sha256:${checked.sha256.slice(0, 12)} ${checked.bytes}字节 [${id}]`;
}

export function restoreToolText(message, record) {
  const id = message?.toolCallId || message?.message?.toolCallId || "";
  if (!id) return message;
  const checked = verifiedRaw(record?.toolCallId ? record : { ...record, toolCallId: id });
  if (!checked.ok) return message;
  return {
    ...message,
    role: message?.role || message?.message?.role || "tool",
    content: checked.text,
    toolCallId: id,
  };
}

export function verifiedIds(records) {
  const ids = new Set();
  for (const record of records || []) {
    if (record?.toolCallId && verifiedRaw(record).ok) ids.add(record.toolCallId);
  }
  return ids;
}

export function runPruneAfterCapture(ids, captured, prune) {
  for (const id of ids || []) {
    if (!captured?.has?.(id)) throw new Error(`spine: raw backup missing before prune: ${id}`);
  }
  return prune();
}
