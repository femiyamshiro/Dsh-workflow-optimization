import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const modulePath = process.argv[2] ? resolve(process.argv[2]) : new URL("../raw.js", import.meta.url);
const { captureToolResult } = await import(modulePath instanceof URL ? modulePath : pathToFileURL(modulePath));
const root = mkdtempSync(join(tmpdir(), "storage-local-cap-"));
const old = process.env.SPINE_SHADOW_MAX_BYTES;
try {
  process.env.SPINE_SHADOW_MAX_BYTES = "100";
  const record = captureToolResult({ root, dir: root, toolCallId: "oversize", text: "x".repeat(1000) });
  const bytes = readdirSync(root).reduce((total, name) => total + statSync(join(root, name)).size, 0);
  console.log(JSON.stringify({ check: "100-byte cap refuses 1000-byte raw before publishing files", record, bytes }));
  assert.equal(record.ok, false);
  assert.equal(bytes, 0);
  assert.deepEqual(readdirSync(root), []);
} finally {
  if (old === undefined) delete process.env.SPINE_SHADOW_MAX_BYTES; else process.env.SPINE_SHADOW_MAX_BYTES = old;
  rmSync(root, { recursive: true, force: true });
}
