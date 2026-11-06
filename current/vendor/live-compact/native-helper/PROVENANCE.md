# Fixed native transaction helper

MIT source: deepseek-ai/deepseek-harness, upstream commit b830ec950faba0a46dda564be3e2d854afed94f1 (local archive checkpoint 671d368f7f5190c8f99ad8c1de412eedf1b4c2be); package @deepseek-ai/dsh-compaction-basic 0.2.1-rc.5.

- packages/compaction/compaction-basic/src/region.ts: SHA-256 295b53cc9e924f7cb2e843e0d0d296e89ead73da2aab9790282db30736e2e063
- packages/compaction/compaction-basic/src/summarizer.ts: SHA-256 03ef6eb0b6a011530829820e30ff709c2c1b34cfa37a98c19c0037432b9d2f55
- LICENSE: SHA-256 ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be

This helper is private upstream implementation, **not a public package export**. The public Basic compactRegion requires an open turn; compactNow selects its own entire range. A local copy enables selected-span idle compaction without changing DSH core.

Transform: Node stripTypeScriptTypes(transform), remove unused selectCompactableRange/assertNoActiveCompaction functions; import frameSummary from local frame.js. All transaction lock, cancellation, balanced boundaries, priced stability, error closure, native source factory, shadow heuristic pricing and flush/error semantics remain the upstream implementation. Local summarize recovery returns false (no custom retry), selection uses owner:null and selected-span stability. Local framing preserves the plugin's no-new-authority warning and adds native summary tags.

The private verification workspace used a generator over the fixed source files above. That host-bound generator is not included here; do not resolve the local archive checkpoint as an upstream Git commit. The original plugin remains MerkyorLynn/dsh-live-compact@c50c58b00cf8545c6524272563f99bc7f2779384 under its unchanged LICENSE. Compatibility is qualified only for this local rc5 candidate, not other DSH versions.
