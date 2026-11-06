import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { captureToolResult, pointerFor, rawName, verifiedRaw } from "../raw.js";
import { measureShadowStore, recordCutStats, STORAGE_LOCK, writeShadowFile } from "../shadow.js";
import { searchShadow } from "../shadow-search.js";
const require = createRequire(import.meta.url);
const mutableFs = require("node:fs");
const root = fs.mkdtempSync(join(tmpdir(), "storage-local-edge-"));
const oldCap = process.env.SPINE_SHADOW_MAX_BYTES;
const results = [];
function store(name) { return join(root, name); }
function cap(bytes) { process.env.SPINE_SHADOW_MAX_BYTES = String(bytes); }
function snapshot(dir) {
  const data = {};
  if (!fs.existsSync(dir)) return data;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) for (const [name, body] of Object.entries(snapshot(path))) data[`${item.name}/${name}`] = body;
    else data[item.name] = fs.readFileSync(path).toString("hex");
  }
  return data;
}
function check(name, fn) { fn(); results.push({ check: name, pass: true }); }
function withFault(name, replacement, fn) {
  const original = mutableFs[name]; mutableFs[name] = replacement(original); syncBuiltinESMExports();
  try { return fn(); } finally { mutableFs[name] = original; syncBuiltinESMExports(); }
}
function capture(name, id, text = "x".repeat(100)) {
  return captureToolResult({ root: store(name), dir: join(store(name), "session"), toolCallId: id, text });
}
try {
  check("total cap counts raw metadata, owners, shadows and stats across sessions", () => {
    cap(2000);
    const saved = capture("total", "original", "raw".repeat(100)); assert.equal(saved.ok, true);
    const shadow = writeShadowFile({ root: store("total"), dir: join(store("total"), "other"), name: "cut-1-aaaaaaaa.txt", body: "shadow".repeat(70) });
    assert.equal(shadow.ok, true);
    assert.equal(recordCutStats(store("total"), { saved: 20 }).cuts, 1);
    const measured = measureShadowStore(store("total"));
    const independent = Object.values(snapshot(store("total"))).reduce((sum, hex) => sum + hex.length / 2, 0);
    assert.equal(measured, independent); assert.ok(measured > 300 + 420);
    cap(measured + 10);
    const before = snapshot(store("total"));
    assert.equal(capture("total", "metadata-cannot-fit", "12345678").ok, false);
    assert.equal(writeShadowFile({ root: store("total"), dir: join(store("total"), "other"), name: "cut-2-bbbbbbbb.txt", body: "z".repeat(11) }).ok, false);
    assert.equal(recordCutStats(store("total"), { saved: 30 }), null);
    assert.deepEqual(snapshot(store("total")), before);
    assert.ok(verifiedRaw(saved).ok);
  });
  check("oversize shadow and raw leave all active/current/unknown existing files untouched", () => {
    cap(4096);
    const saved = capture("preserve", "active"); assert.ok(saved.ok);
    const dir = join(store("preserve"), "session");
    const shadow = writeShadowFile({ root: store("preserve"), dir, name: "cut-1-aaaaaaaa.txt", body: "current checkpoint" }); assert.ok(shadow.ok);
    fs.writeFileSync(join(store("preserve"), "user-notes.txt"), "do not delete", { mode: 0o600 });
    const before = snapshot(store("preserve")); cap(measureShadowStore(store("preserve")) + 1);
    assert.equal(capture("preserve", "overflow", "z".repeat(10000)).ok, false);
    assert.equal(writeShadowFile({ root: store("preserve"), dir, name: "cut-2-bbbbbbbb.txt", body: "z".repeat(10000) }).ok, false);
    assert.deepEqual(snapshot(store("preserve")), before);
    assert.ok(verifiedRaw(saved).ok);
  });
  check("new root/session and raw/meta/owner/chunks/stats use 0700/0600", () => {
    cap(10000); const saved = capture("modes", "modes"); assert.ok(saved.ok);
    const dir = join(store("modes"), "session");
    assert.ok(writeShadowFile({ root: store("modes"), dir, name: "cut-1-aaaaaaaa.txt", body: "chunk" }).ok);
    assert.ok(recordCutStats(store("modes"), { saved: 1 }));
    for (const path of [store("modes"), dir]) assert.equal(fs.statSync(path).mode & 0o777, 0o700);
    for (const name of Object.keys(snapshot(store("modes")))) assert.equal(fs.statSync(join(store("modes"), name)).mode & 0o777, 0o600);
  });
  check("existing raw requires intact first metadata and full hash; truncated/tampered data never gets a pointer", () => {
    cap(10000); const saved = capture("trust", "first", "original full body"); assert.ok(saved.ok);
    fs.writeFileSync(saved.path, "original");
    assert.equal(capture("trust", "first", "replacement").ok, false);
    assert.equal(verifiedRaw(saved).ok, false); assert.equal(pointerFor(saved), "无完整备份 [first]");
    const original = capture("trust", "meta", "full second body"); assert.ok(original.ok);
    fs.unlinkSync(`${original.path}.meta.json`);
    assert.equal(verifiedRaw(original).ok, false);
    assert.equal(capture("trust", "meta", "replacement").ok, false);
    assert.equal(fs.readFileSync(original.path, "utf8"), "full second body");
  });
  check("search skips incomplete/tampered raw and symbolic-link files", () => {
    cap(10000); const saved = capture("search", "search", "needle in full original"); assert.ok(saved.ok);
    const dir = join(store("search"), "session");
    assert.equal(searchShadow({ dir, pattern: "needle" }).matches.length, 1);
    fs.writeFileSync(saved.path, "needle tampered");
    assert.equal(searchShadow({ dir, pattern: "needle" }).matches.length, 0);
    const outside = store("search-outside.txt"); fs.writeFileSync(outside, "needle", { mode: 0o600 });
    fs.symlinkSync(outside, join(dir, "cut-1-aaaaaaaa.txt"));
    assert.equal(searchShadow({ dir, pattern: "needle" }).matches.length, 0);
  });
  check("symbolic/hard links and world-readable old stores fail closed without changing outside data", () => {
    cap(10000); const outside = store("outside.txt"); fs.writeFileSync(outside, "sentinel", { mode: 0o600 });
    fs.mkdirSync(store("links"), { mode: 0o700 }); fs.symlinkSync(outside, join(store("links"), rawName("linked")));
    assert.equal(captureToolResult({ dir: store("links"), toolCallId: "linked", text: "replace" }).ok, false);
    assert.equal(fs.readFileSync(outside, "utf8"), "sentinel");
    fs.mkdirSync(store("hard"), { mode: 0o700 }); fs.linkSync(outside, join(store("hard"), "foreign"));
    assert.equal(captureToolResult({ dir: store("hard"), toolCallId: "hard", text: "replace" }).ok, false);
    fs.mkdirSync(store("broad"), { mode: 0o755 });
    assert.equal(captureToolResult({ dir: store("broad"), toolCallId: "broad", text: "replace" }).ok, false);
    assert.equal(fs.statSync(store("broad")).mode & 0o777, 0o755);
  });
  check("busy lock returns immediately without stale takeover or mutation", () => {
    cap(10000); fs.mkdirSync(store("busy"), { mode: 0o700 });
    fs.writeFileSync(join(store("busy"), STORAGE_LOCK), "", { mode: 0o600 });
    const before = snapshot(store("busy")); const started = Date.now();
    const record = captureToolResult({ dir: store("busy"), toolCallId: "busy", text: "untouched" });
    assert.equal(record.ok, false); assert.equal(record.reason, "storage-busy");
    assert.ok(Date.now() - started < 1000); assert.deepEqual(snapshot(store("busy")), before);
  });
  check("partial-write ENOSPC removes owned staging files and keeps originals unchanged", () => {
    cap(10000); assert.ok(capture("partial", "prior").ok); const before = snapshot(store("partial"));
    const record = withFault("writeFileSync", (write) => (fd, body, ...args) => {
      if (typeof fd === "number") { write(fd, Buffer.from(body).subarray(0, 5)); throw Object.assign(Error("synthetic ENOSPC"), { code: "ENOSPC" }); }
      return write(fd, body, ...args);
    }, () => capture("partial", "failed", "new full body"));
    assert.equal(record.ok, false); assert.equal(record.code, "ENOSPC");
    assert.deepEqual(snapshot(store("partial")), before); assert.equal(verifiedRaw(record).ok, false);
  });
  check("failure after first publication cleans only this incomplete raw/meta pair", () => {
    cap(10000); assert.ok(capture("publish", "prior").ok); const before = snapshot(store("publish"));
    let published = 0;
    const record = withFault("renameSync", (rename) => (...args) => {
      if (++published === 2) throw Object.assign(Error("synthetic ENOSPC"), { code: "ENOSPC" });
      return rename(...args);
    }, () => capture("publish", "failed", "new full body"));
    assert.equal(record.ok, false); assert.equal(published, 2); assert.deepEqual(snapshot(store("publish")), before);
  });
  // Two independent Node processes race through the same 900-byte root. Each
  // would fit alone; together their payload+metadata+owner exceed capacity.
  cap(900); fs.mkdirSync(store("race"), { mode: 0o700 });
  const rawURL = new URL("../raw.js", import.meta.url).href;
  const script = `import {captureToolResult} from ${JSON.stringify(rawURL)};import{join}from'node:path';process.stdin.once('data',()=>{const root=process.argv[1],id=process.argv[2];console.log(JSON.stringify(captureToolResult({root,dir:join(root,id),toolCallId:id,text:'x'.repeat(500)})));});console.log('ready');`;
  function child(id) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, store("race"), id], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { error += chunk; });
    const ready = new Promise((resolve, reject) => { const tick = () => output.includes("ready\n") ? resolve() : child.exitCode !== null ? reject(Error(error || output)) : setTimeout(tick, 5); tick(); });
    const done = new Promise((resolve, reject) => child.on("exit", (code) => code ? reject(Error(error || output)) : resolve(JSON.parse(output.trim().split("\n").at(-1)))));
    return { child, ready, done };
  }
  const left = child("left"), right = child("right");
  await Promise.all([left.ready, right.ready]); left.child.stdin.end("go"); right.child.stdin.end("go");
  const race = await Promise.all([left.done, right.done]);
  assert.equal(race.filter((item) => item.ok).length, 1); assert.ok(measureShadowStore(store("race")) <= 900);
  assert.equal(fs.existsSync(join(store("race"), STORAGE_LOCK)), false);
  results.push({ check: "two cooperating processes cannot race past shared total cap", pass: true, outcomes: race.map(({ ok, reason }) => ({ ok, reason })), bytes: measureShadowStore(store("race")) });
  console.log(JSON.stringify({ results }, null, 2));
} finally {
  if (oldCap === undefined) delete process.env.SPINE_SHADOW_MAX_BYTES; else process.env.SPINE_SHADOW_MAX_BYTES = oldCap;
  fs.rmSync(root, { recursive: true, force: true });
}
