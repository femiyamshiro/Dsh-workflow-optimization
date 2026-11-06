import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureToolResult } from "../raw.js";
import { searchShadow } from "../shadow-search.js";

const root = mkdtempSync(join(tmpdir(), "storage-local-search-excerpt-"));
const oldCap = process.env.SPINE_SHADOW_MAX_BYTES;
const results = [];
try {
  process.env.SPINE_SHADOW_MAX_BYTES = "100000";
  const dir = join(root, "synthetic-session");
  // One physical JSON-escaped line, representative of serialized tool output.
  // The actual fact and adjacent numeric value occur well after character 400.
  const raw = JSON.stringify({ output: `${"prefix ".repeat(240)}\n"CONTROL_KNOB":"keepDays","ADJACENT_VALUE":21\n${"suffix ".repeat(240)}` });
  assert.ok(raw.indexOf("CONTROL_KNOB") > 400);
  const saved = captureToolResult({ root, dir, toolCallId: "long-json-output", text: raw });
  assert.ok(saved.ok);
  for (const options of [
    { label: "literal", pattern: "CONTROL_KNOB" },
    { label: "ignoreCase", pattern: "control_knob", ignoreCase: true },
    { label: "regex", pattern: "CONTROL_[A-Z]+", regex: true },
    { label: "regex ignoreCase", pattern: "control_[a-z]+", regex: true, ignoreCase: true },
  ]) {
    const found = searchShadow({ dir, ...options });
    assert.equal(found.matches.length, 1);
    const hit = found.matches[0];
    results.push({ check: options.label, line: hit.line, length: hit.text.length,
      containsFact: hit.text.includes("CONTROL_KNOB"), containsValue: hit.text.includes("keepDays") && hit.text.includes('ADJACENT_VALUE\\\":21'),
      leadingEllipsis: hit.text.startsWith("…"), trailingEllipsis: hit.text.endsWith("…") });
  }
  console.log(JSON.stringify({ results }, null, 2));
  for (const result of results) {
    assert.equal(result.containsFact, true, `${result.check}: actual matched fact must be visible`);
    assert.equal(result.containsValue, true, `${result.check}: adjacent value must be visible`);
    assert.equal(result.line, 1); assert.ok(result.length <= 400);
    assert.equal(result.leadingEllipsis, true); assert.equal(result.trailingEllipsis, true);
  }
  const nearStart = JSON.stringify({ fact: "START_FACT=17", suffix: "x".repeat(1000) });
  const nearEnd = `${"y".repeat(1000)} END_FACT=19`;
  const short = "short unchanged line: SHORT_FACT=23";
  for (const [id, text] of [["start", nearStart], ["end", nearEnd], ["short", short]]) {
    assert.ok(captureToolResult({ root, dir, toolCallId: id, text }).ok);
  }
  const first = searchShadow({ dir, pattern: "START_FACT" }).matches[0];
  assert.ok(first.text.includes("START_FACT=17")); assert.equal(first.text.startsWith("…"), false); assert.ok(first.text.endsWith("…")); assert.ok(first.text.length <= 400);
  const last = searchShadow({ dir, pattern: "END_FACT" }).matches[0];
  assert.ok(last.text.includes("END_FACT=19")); assert.ok(last.text.startsWith("…")); assert.equal(last.text.endsWith("…"), false); assert.ok(last.text.length <= 400);
  assert.equal(searchShadow({ dir, pattern: "SHORT_FACT" }).matches[0].text, short);
  // The first occurrence, rather than a later repeated term, selects the excerpt.
  assert.ok(captureToolResult({ root, dir, toolCallId: "repeat", text: `${"z".repeat(900)} REPEATED=first ${"z".repeat(900)} REPEATED=second` }).ok);
  const repeated = searchShadow({ dir, pattern: "REPEATED" }).matches[0];
  assert.ok(repeated.text.includes("REPEATED=first")); assert.equal(repeated.text.includes("REPEATED=second"), false);
  // Expanded lowercase text must not move the returned window away from the
  // original match offset; preserve the existing literal case-fold semantics.
  assert.ok(captureToolResult({ root, dir, toolCallId: "unicode-prefix", text: `${"İ".repeat(1000)} UNICODE_FACT=29 ${"tail".repeat(200)}` }).ok);
  const unicode = searchShadow({ dir, pattern: "unicode_fact", ignoreCase: true }).matches[0];
  assert.ok(unicode.text.includes("UNICODE_FACT=29")); assert.ok(unicode.text.length <= 400);
  console.log("short/start/end/first occurrence/expanded case-fold offset checks passed");
} finally {
  if (oldCap === undefined) delete process.env.SPINE_SHADOW_MAX_BYTES; else process.env.SPINE_SHADOW_MAX_BYTES = oldCap;
  rmSync(root, { recursive: true, force: true });
}
