/**
 * Private, bounded shadow storage. Capacity is the sum of regular-file st_size
 * under one configured root, including raw metadata, owners, stats and staging
 * files (not directory entries/filesystem allocation). Cooperating writers use
 * one non-waiting root lock. Full/busy/unsafe stores drop new backups; no rotation
 * deletes old cards, raw pointers or another session's files.
 */
import { randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const PLUGIN_NAME = /^(?:(?:cut|official|shadow)-\d+-[0-9a-f]{8}|raw-[0-9a-f]{16}|\d+-[0-9a-f]{8}-[0-9a-f]{8}|\d+-[0-9a-f]{8,16})\.txt$/;
export const STORAGE_LOCK = ".spine-storage.lock";
export const STATS_NAME = "spine-stats.json";
const MAX_ENTRIES = 10000;
const MAX_DEPTH = 16;

export function isPluginShadowName(name) { return PLUGIN_NAME.test(name); }
export function sanitizeSessionKey(key) {
  return String(key || "default").replace(/[^A-Za-z0-9_-]/g, "") || "default";
}
export function sessionDir(root, key) { return join(root, sanitizeSessionKey(key)); }
export function shadowFileBody(sessionKey, body) {
  return `# spine-session ${String(sessionKey || "default").replace(/\s+/g, "")}\n${body || ""}`;
}
export function shadowMaxBytes(env = process.env) {
  const bytes = Number(env.SPINE_SHADOW_MAX_BYTES);
  if (Number.isSafeInteger(Math.floor(bytes)) && bytes >= 1) return Math.floor(bytes);
  const mb = Number(env.SPINE_SHADOW_MAX_MB);
  if (Number.isSafeInteger(Math.floor(mb * 1024 * 1024)) && mb * 1024 * 1024 >= 1) return Math.floor(mb * 1024 * 1024);
  return 256 * 1024 * 1024;
}
function fault(reason) { return Object.assign(new Error(reason), { storageReason: reason }); }
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function privateInfo(info, directory = false) {
  return (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)
    && (typeof process.getuid !== "function" || info.uid === process.getuid())
    && (info.mode & 0o077) === 0;
}

// Check existing ancestors without following symbolic links. Existing store
// directories are never chmod'ed: unsafe old layouts fail closed.
function ensureDirectory(path, privateDirectory = true) {
  const parent = dirname(path);
  if (parent !== path) ensureDirectory(parent, false);
  let info;
  try { info = lstatSync(path); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
    info = lstatSync(path);
  }
  if (!info.isDirectory() || (privateDirectory && !privateInfo(info, true))) throw fault("unsafe-store");
  return info;
}
function regularInfo(info) { return info.isFile() && info.nlink === 1; }
function checkedOpen(path, privateOnly) {
  for (let parent = dirname(resolve(path)); ; parent = dirname(parent)) {
    if (!lstatSync(parent).isDirectory()) throw fault("unsafe-file");
    if (parent === dirname(parent)) break;
  }
  const before = lstatSync(path);
  const acceptable = privateOnly ? privateInfo : regularInfo;
  if (!acceptable(before)) throw fault("unsafe-file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!acceptable(info) || !sameFile(before, info)) throw fault("unsafe-file");
    return { fd, info };
  } catch (error) { closeSync(fd); throw error; }
}

// Full-file reads used for endorsement require a private, singly linked regular
// file and stable descriptor/path identity. This does not defend a hostile owner
// that changes contents in place and restores timestamps during the read.
export function readPrivateFile(path, maxBytes = shadowMaxBytes()) {
  return readRegularFile(path, maxBytes, true);
}
export function readRegularFile(path, maxBytes, privateOnly = false) {
  const { fd, info } = checkedOpen(path, privateOnly);
  try {
    if (info.size > maxBytes) throw fault("storage-full");
    const body = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < body.length) {
      const count = readSync(fd, body, offset, body.length - offset, offset);
      if (!count) throw fault("changed-file");
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset)) throw fault("changed-file");
    const after = fstatSync(fd);
    const named = lstatSync(path);
    if (!sameFile(info, after) || !sameFile(info, named) || !(privateOnly ? privateInfo(named) : regularInfo(named))
      || info.size !== body.length || after.size !== body.length
      || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw fault("changed-file");
    return body;
  } finally { closeSync(fd); }
}

export function measureShadowStore(root) {
  let used = 0;
  let entries = 0;
  function walk(dir, depth) {
    if (depth > MAX_DEPTH) throw fault("storage-scan-limit");
    for (const name of readdirSync(dir)) {
      if (++entries > MAX_ENTRIES) throw fault("storage-scan-limit");
      const path = join(dir, name);
      const info = lstatSync(path);
      if (info.isDirectory()) walk(path, depth + 1);
      else if (info.isFile() && info.nlink === 1) used += info.size;
      else throw fault("unsafe-store");
      if (!Number.isSafeInteger(used)) throw fault("storage-full");
    }
  }
  walk(resolve(root), 0);
  return used;
}

function removeOwned(path, info) {
  try { if (sameFile(lstatSync(path), info)) unlinkSync(path); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

// Internal common transaction for raw pairs, shadow chunks, owner markers and
// stats. Staging bytes coexist with old files and count toward the admission.
// No stale-lock takeover: a crashed/unknown writer requires explicit recovery.
export function withShadowStore({ root, dir = root, ownerPid }, action) {
  const cap = shadowMaxBytes();
  let fd;
  let lockInfo;
  let rootInfo;
  let result;
  let lock;
  try {
    root = resolve(root);
    dir = resolve(dir);
    const rel = relative(root, dir);
    if (rel && (rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(sep))) throw fault("unsafe-store");
    rootInfo = ensureDirectory(root);
    lock = join(root, STORAGE_LOCK);
    try { fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error?.code === "EEXIST") throw fault("storage-busy"); throw error; }
    lockInfo = fstatSync(fd);
    ensureDirectory(dir);
    if (!sameFile(rootInfo, lstatSync(root))) throw fault("changed-store");
    let used = measureShadowStore(root);
    const write = (files, { replace = false } = {}) => {
      const planned = files.map(({ name, body }) => {
        if (!name || basename(name) !== name || name === STORAGE_LOCK || name === "." || name === "..") throw fault("unsafe-file");
        return { path: join(dir, name), bytes: Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8") };
      });
      if (ownerPid !== undefined && dir !== root) {
        const owner = join(dir, "owner");
        try { readPrivateFile(owner, cap); }
        catch (error) {
          if (error?.code !== "ENOENT") throw error;
          planned.push({ path: owner, bytes: Buffer.from(String(ownerPid)) });
        }
      }
      if (new Set(planned.map(({ path }) => path)).size !== planned.length) throw fault("unsafe-file");
      const incoming = planned.reduce((sum, item) => sum + item.bytes.length, 0);
      // No file, including an oversized singleton, is created before admission.
      if (used > cap || incoming > cap - used) return { ok: false, reason: "storage-full", used, cap };
      const staged = [];
      const published = [];
      try {
        for (const item of planned) {
          let existing = null;
          try {
            existing = lstatSync(item.path);
            if (!replace || !privateInfo(existing)) throw fault("existing-file");
          } catch (error) { if (error?.code !== "ENOENT") throw error; }
          const tmp = join(dir, `.spine-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
          const output = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          const stagedInfo = fstatSync(output);
          staged.push({ path: tmp, info: stagedInfo });
          try { writeFileSync(output, item.bytes); fsyncSync(output); }
          finally { closeSync(output); }
          if (!readPrivateFile(tmp, cap).equals(item.bytes)) throw fault("write-verification-failed");
          item.tmp = tmp;
          item.existing = existing;
        }
        if (!sameFile(rootInfo, lstatSync(root))) throw fault("changed-store");
        for (const item of planned) {
          let now = null;
          try { now = lstatSync(item.path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
          if (item.existing ? !now || !sameFile(now, item.existing) : now) throw fault("changed-file");
          renameSync(item.tmp, item.path);
          if (!item.existing) published.push({ path: item.path, info: lstatSync(item.path) });
        }
        // Readback before returning a pointer. Only newly created files may be
        // removed on failure; prior stats/owner/captures are never blindly unlinked.
        for (const item of planned) if (!readPrivateFile(item.path, cap).equals(item.bytes)) throw fault("write-verification-failed");
        used = measureShadowStore(root);
        if (used > cap) throw fault("storage-full");
        return { ok: true, used, cap };
      } catch (error) {
        for (const item of published.reverse()) { try { removeOwned(item.path, item.info); } catch {} }
        throw error;
      } finally {
        for (const item of staged) { try { removeOwned(item.path, item.info); } catch {} }
      }
    };
    result = action({ used, cap, write });
  } catch (error) {
    result = { ok: false, reason: error?.storageReason || "unwritable", code: error?.code, cap };
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
      try { if (sameFile(rootInfo, lstatSync(root))) removeOwned(lock, lockInfo); } catch {}
    }
  }
  return result;
}

export function writeShadowFile({ root, dir, name, file, body, ownerPid = process.pid }) {
  name ??= file && basename(file);
  if (file && resolve(file) !== resolve(dir, name)) return { ok: false, reason: "unsafe-file" };
  return withShadowStore({ root, dir, ownerPid }, ({ write }) => {
    const result = write([{ name, body }]);
    return result.ok ? { ...result, path: join(resolve(dir), name), file: join(resolve(dir), name) } : result;
  });
}

export function readCutStats(dir) {
  try {
    const parsed = JSON.parse(readPrivateFile(join(dir, STATS_NAME), 65536).toString("utf8"));
    return { cuts: Number(parsed.cuts) || 0, savedTokens: Number(parsed.savedTokens) || 0, rewriteTokens: Number(parsed.rewriteTokens) || 0 };
  } catch { return { cuts: 0, savedTokens: 0, rewriteTokens: 0 }; }
}
export function recordCutStats(dir, { saved = 0, rewrite = 0 } = {}) {
  if (!(saved > 0)) return readCutStats(dir);
  const result = withShadowStore({ root: dir }, ({ write }) => {
    const prev = readCutStats(dir);
    const next = { cuts: prev.cuts + 1, savedTokens: prev.savedTokens + saved, rewriteTokens: prev.rewriteTokens + rewrite, updatedAt: new Date().toISOString() };
    const result = write([{ name: STATS_NAME, body: JSON.stringify(next) }], { replace: true });
    return result.ok ? next : null;
  });
  return result?.ok === false ? null : result;
}

export function listPluginShadows(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const files = [];
  for (const name of names) {
    if (!isPluginShadowName(name)) continue;
    const path = resolve(dir, name);
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.nlink !== 1) continue;
      // Listing never follows links or opens a potentially huge body.
      files.push({ name, path, size: info.size, mtimeMs: info.mtimeMs, sessionKey: "" });
    } catch {}
  }
  return files;
}
export function listShadowEntries(dir) {
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const rootFiles = listPluginShadows(dir);
  return names.flatMap((entry) => entry.isDirectory()
    ? listPluginShadows(join(dir, entry.name)).map((file) => ({ ...file, legacy: false, live: true, sessionKey: entry.name }))
    : entry.isFile() && isPluginShadowName(entry.name)
      ? rootFiles.filter((file) => file.name === entry.name).map((file) => ({ ...file, legacy: true, live: false })) : []);
}

// Compatibility-only admission query. A query cannot reserve space: actual
// writers must use withShadowStore/writeShadowFile. This function deletes none.
export function rotateShadow({ dir, incomingBytes, cap = shadowMaxBytes() }) {
  try {
    const used = measureShadowStore(dir);
    const oversize = incomingBytes > cap;
    return { ok: !oversize && used + incomingBytes <= cap, deleted: 0, freed: 0, used, cap, oversize, failed: false };
  } catch { return { ok: false, deleted: 0, freed: 0, cap, failed: true }; }
}
