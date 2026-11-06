/**
 * 边做边压 / Live Compact。替换宿主的压缩后端，不改前缀字节。
 * Replacement compaction backend. Do not rewrite the cached prefix.
 *
 * 注释说明来自 UnwhiteCat 的 PR #3，按当前行为改写。
 * Notes follow UnwhiteCat's PR #3, rewritten for the current behavior.
 *
 * 小切在轮次结束后做，不调模型。最近 3 个已结束的工具轮留在原处。
 * 切法和 1.0.6 一样：不越过用户消息，最近的工具轮按原预算留在原处。
 * 不够 1000 token 就跳过，不回头凑。超过 65 万停掉小切，交给官方大压缩。
 * The small cut runs after the turn, with no model call. The cut matches 1.0.6:
 * it does not cross a user message, and recent tool rounds stay within the
 * original token budget. Under 1000 tokens, skip. Do not walk back to manufacture
 * a cut. Above 650000, small cuts stop for the host gate.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { scopeOf, scopeChainOf } from "@deepseek-ai/dsh-scope";
import { compactSurfaceRegion } from "./native-helper/region.js";
import { attachBackupHint, backgroundJobId, backupClaimOk, buildCard, chooseKeptSpan, collectJobs, fallbackProviderURL, indexToolCalls, jobCutDecision, keptToolRounds, lookupProviderURL, messageText, planMessages, pointerOnlyText, pointerSpanAllowed, protectedMessage, RAIL_TOKENS, readResultLabel, reservedCutEnd, resolveEngine, selectCutIndexes, shadowSections, takeLocalCut, withoutFullBackupClaim } from "./plan.js";
import { captureToolResult, rawExcerptText, restoreToolText, verifiedRaw } from "./raw.js";
import { recordCutStats, sessionDir, shadowFileBody, writeShadowFile } from "./shadow.js";
import { buildSendLess, decideThunder } from "./thunder.js";

const MARK = "Spine extract.";
const SPINE_SOURCE_KIND = "spine-checkpoint";
const CHUNK_MIN = 1000; // 不够这一刀就不切，避免每轮一张碎卡片。
const CHUNK_MAX = RAIL_TOKENS; // 一刀最多 3.2 万，和卡片轨道对齐。
const POINTER_TOKENS = Number(process.env.SPINE_POINTER_TOKENS || CHUNK_MAX); // 单个工具结果超过这个数才只留指针。默认仍是 3.2 万。
const BIG_GATE = 650000; // 绝对停切线，不是窗口比例。1M 官方大门约 678464。
const URGENT_TOKENS = 48000;
const MAX_TAIL = 2200;
const MIN_PRESSURE = Number(process.env.SPINE_MIN_TOKENS || 20000);
const KEEP_ROUNDS = Number(process.env.SPINE_KEEP_ROUNDS || 3);
const KEEP_ROUND_TOKENS = Number(process.env.SPINE_KEEP_ROUND_TOKENS || 32000);
const MAX_TRACKED_SESSIONS = 64;
const DEFAULT_KEY = "__default__";

function eventText(session, seq) {
  const event = session.eventAt(seq);
  if (event?.type === "user/message") return messageText(event.data);
  if (event?.type === "assistant/message") return messageText(event.data?.message);
  return messageText(event?.data);
}

function isCheckpoint(session, seq) {
  const event = session.eventAt(seq);
  const kind = event?.data?.source?.kind;
  // Keep both legacy plugin cards and public native checkpoints intact in small cuts.
  if (kind === SPINE_SOURCE_KIND || kind === "compact-checkpoint") return true;
  return eventText(session, seq).includes(MARK);
}

function protectedEvent(session, seq) {
  const event = session.eventAt(seq);
  if (event?.type === "system/message" || event?.type === "developer/message") return true;
  return event?.type === "user/message" && protectedMessage(event.data);
}

function eventRole(session, seq) {
  const type = session.eventAt(seq)?.type;
  if (type === "user/message") return "user";
  if (type === "assistant/message") return "assistant";
  if (type === "tool/result") return "tool";
  return "other";
}

function isUser(session, seq) {
  return session.eventAt(seq)?.type === "user/message";
}

function cutOk(fn, session, seq) {
  try {
    return fn(session, seq);
  } catch {
    return false;
  }
}

function shadowDirectory() {
  if (process.env.SPINE_SHADOW_DIR) return process.env.SPINE_SHADOW_DIR;
  const root = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(root, "compaction-spine", "shadow");
}

function sessionKey(agent) {
  const id = agent?.session?.id;
  return typeof id === "string" && id.length > 0 ? id : DEFAULT_KEY;
}

function shadowBody(messages) {
  return (messages || []).map((message) => shadowSections(message)).join("\n\n");
}

function freshShadowFile(kind, key) {
  const dir = sessionDir(shadowDirectory(), key);
  return join(dir, `${kind}-${Date.now()}-${randomBytes(4).toString("hex")}.txt`);
}

function commandFromCall(event) {
  if (event?.type !== "tool/call") return "";
  let args = event.data?.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  const command = args?.command || args?.cmd || event.data?.name || "";
  return String(command || "").split("\n")[0].trim();
}

function shadowFilePath(requested, key) {
  if (requested) return requested;
  return freshShadowFile("shadow", key);
}

// 从后往前选一刀，和 1.0.6 一样。不越过用户消息。工具对必须成对。
// 最近的工具轮按 KEEP_ROUND_TOKENS 留在原处。不够 CHUNK_MIN 就返回 null。
// Pick one span from the tail, as in 1.0.6. Do not cross a user message.
// Tool pairs stay balanced. Recent tool rounds stay within KEEP_ROUND_TOKENS.
// Under CHUNK_MIN, return null.
function selectNewestChunk(session, measurement, key = DEFAULT_KEY, context = {}) {
  const decision = jobCutDecision(context.jobs || []);
  if (!decision.cut) return null;
  const nodes = session.surface.nodes;
  const priced = measurement.nodes;
  if (nodes.length === 0 || nodes.length !== priced.length || nodes.some((seq, index) => priced[index]?.seq !== seq)) return null;
  const first = session.eventAt(nodes[0])?.type === "system/message" ? 1 : 0;
  let end = priced.length - 1;
  while (end >= first) {
    const event = session.eventAt(nodes[end]);
    const shortTail = event?.type === "assistant/message" || (event?.type === "user/message" && priced[end].tokens < 400);
    if (!shortTail) break;
    end -= 1;
  }
  while (end >= first && isCheckpoint(session, nodes[end])) end -= 1;
  while (end >= first && !cutOk(toolPairingBalancedAfter, session, nodes[end])) end -= 1;
  let keptTokens = 0;
  const visible = [];
  for (let index = first; index <= end; index += 1) {
    const event = session.eventAt(nodes[index]);
    const toolCalls = event?.type === "assistant/message"
      ? (event.data?.message?.content || []).filter((block) => block.type === "tool-call").length
      : 0;
    visible.push({ index, type: event?.type === "tool/result" ? "tool" : "other", toolCalls });
  }
  const rounds = keptToolRounds(visible, KEEP_ROUNDS);
  // 收尾也留最近 3 个工具轮。刚读的日志还要用来答题，不能整段换掉。
  // A drain still keeps the latest 3 tool rounds. The log just read is needed for the next answer.
  const span = chooseKeptSpan(rounds, (from, to) => {
    let tokens = 0;
    for (let index = visible[from.start].index; index <= visible[to.end].index; index += 1) tokens += priced[index].tokens;
    return tokens;
  }, KEEP_ROUND_TOKENS);
  const cutEnd = span ? reservedCutEnd(visible[span.start].index, first) : null;
  if (span && cutEnd === null) return null;
  if (cutEnd !== null) {
    const keptEnd = visible[span.end].index;
    for (let index = visible[span.start].index; index <= keptEnd; index += 1) keptTokens += priced[index].tokens;
    end = cutEnd;
    while (end >= first && (isCheckpoint(session, nodes[end]) || isUser(session, nodes[end]))) end -= 1;
    while (end >= first && !cutOk(toolPairingBalancedAfter, session, nodes[end])) end -= 1;
  }
  if (end < first || isCheckpoint(session, nodes[end])) return null;
  const spanPieces = (spanStart, spanEnd) => {
    const pieces = [];
    let pendingCommand = "";
    const callSeqs = new Map();
    for (let index = 0; index < nodes.length; index += 1) {
      const event = session.eventAt(nodes[index]);
      const command = commandFromCall(event);
      if (command) pendingCommand = command;
      for (const block of event?.data?.message?.content || []) {
        if (block?.type === "tool-call" && block.id) callSeqs.set(block.id, nodes[index]);
      }
      if (index < spanStart || index > spanEnd) continue;
      const toolCallId = event?.data?.message?.toolCallId || "";
      const call = toolCallId ? context.calls?.get?.(toolCallId) : null;
      const isTool = event?.type === "tool/result";
      const looked = isTool && context.rawLookup && toolCallId ? (context.rawLookup(toolCallId) || { ok: false, toolCallId }) : null;
      const excerpt = isTool ? rawExcerptText(eventText(session, nodes[index]), looked) : { text: eventText(session, nodes[index]) };
      const text = excerpt.text;
      pieces.push({
        role: eventRole(session, nodes[index]),
        text,
        isError: Boolean(event?.data?.message?.isError || event?.data?.isError),
        command: call?.command || (event?.type === "tool/result" ? pendingCommand : ""),
        name: call?.name || "",
        toolCallId,
        seq: nodes[index],
        callSeq: toolCallId ? callSeqs.get(toolCallId) : undefined,
        turn: Number.isInteger(event?.data?.turn) ? event.data.turn : call?.turn,
        backgroundStart: event?.type === "tool/result" && Boolean(backgroundJobId(text)),
        raw: looked ? (excerpt.raw?.ok ? excerpt.raw : { ok: false, toolCallId }) : undefined,
      });
      if (event?.type === "tool/result") pendingCommand = "";
    }
    return pieces;
  };
  const spanText = (spanStart, spanEnd) => spanPieces(spanStart, spanEnd).map((piece) => piece.text).join("\n");
  const liveText = (spanStart, spanEnd) => {
    const bits = [];
    for (let index = 0; index < nodes.length; index += 1) {
      if (index >= spanStart && index <= spanEnd) continue;
      bits.push(eventText(session, nodes[index]));
    }
    return bits.join("\n");
  };
  const extras = { jobs: context.jobs || [] };
  const items = nodes.map((seq, index) => {
    const event = session.eventAt(seq);
    const type = event?.type === "user/message" ? "user"
      : event?.type === "assistant/message" ? "assistant"
      : event?.type === "tool/result" ? "tool"
      : event?.type === "system/message" ? "system" : "other";
    return {
      type,
      tokens: priced[index].tokens,
      checkpoint: isCheckpoint(session, seq),
      protected: protectedEvent(session, seq),
      balancedBefore: cutOk(toolPairingBalancedBefore, session, seq),
      balancedAfter: cutOk(toolPairingBalancedAfter, session, seq),
    };
  });
  const picked = selectCutIndexes(items, {
    engine: context.engine || "cloud",
    chunkMin: CHUNK_MIN,
    chunkMax: CHUNK_MAX,
    pointerMax: POINTER_TOKENS,
    maxEnd: end,
    totalTokens: context.totalTokens,
    drain: context.drain === true,
    urgentTokens: URGENT_TOKENS,
    keepBudget: KEEP_ROUND_TOKENS,
  });
  if (!picked) return null;
  if (picked.pointerOnly) {
    const result = session.eventAt(nodes[picked.end]);
    const id = result?.data?.message?.toolCallId;
    let pairStart = -1;
    if (id) {
      for (let index = picked.end - 1; index >= 0; index -= 1) {
        const blocks = session.eventAt(nodes[index])?.data?.message?.content || [];
        if (blocks.some((block) => block?.type === "tool-call" && block.id === id)) {
          pairStart = index;
          break;
        }
      }
    }
    if (pairStart < 0) return null;
    if (!pointerSpanAllowed(items, pairStart, picked.end, context.engine || "cloud")) return null;
    if (!cutOk(toolPairingBalancedBefore, session, nodes[pairStart])) return null;
    picked.start = pairStart;
  }
  const start = picked.start;
  end = picked.end;
  const tokens = items.slice(start, end + 1).reduce((sum, item) => sum + item.tokens, 0);
  let card = picked.pointerOnly
    ? { ok: true, text: pointerOnlyText(spanPieces(start, end)), hardLines: [], missing: [], needsBackup: false, rawPaths: [] }
    : buildCard(spanText(start, end), liveText(start, end), spanPieces(start, end), extras);
  if (card.ok !== true) return null;
  card = attachBackupHint(card, freshShadowFile("cut", key));
  if (!card.text.includes("不是备份文件路径")) card = { ...card, text: `${card.text}\n序号是本会话日志里的事件号，不是备份文件路径。` };
  if (!cutOk(toolPairingBalancedAfter, session, nodes[end])) return null;
  let after = 0;
  for (let index = end + 1; index < priced.length; index += 1) after += priced[index].tokens;
  let prefix = 0;
  for (let index = 0; index < start; index += 1) prefix += priced[index].tokens;
  return { start: nodes[start], end: nodes[end], tokens, after, keptTokens, card, prefix };
}

export { planMessages, selectNewestChunk };

// 只换「切哪一段、怎么换成卡片」。官方大门仍由宿主算。
// Changes which span is cut and how it becomes a card. The host still owns the stock gate.
export default class SpineCompactionEngine extends BasicCompactionEngine {
  // Primitive identity survives Cordis service tracing/proxy access. A root
  // fallback engine must not handle an agent that owns a preset engine.
  liveCompactIdentity = Symbol("live-compact-engine");
  liveCompactScope;
  // Per-session state. One engine instance can serve several agents, so nothing
  // here may live on `this` directly or one agent's card/prefix leaks into another.
  sessionState = new Map();
  rawSeen = new Map();
  pruneGuarded = false;

  constructor(ctx, config) {
    if (process.env.SPINE_ENGINE_FAIL === "construct") throw new Error("spine: constructor refused");
    super(ctx, config);
    this.liveCompactScope = scopeOf(ctx);
    if (process.env.SPINE_ENGINE_FAIL === "after-super") throw new Error("spine: after super");
    try {
      const pendingCuts = new Set();
      ctx.effect(() => async () => {
        await Promise.allSettled(pendingCuts);
      });
      ctx.on("session/event", (session, event) => {
        if (event?.type !== "tool/result") return;
        const agent = ctx.get?.("agents")?.get?.(session.id);
        if (agent && !this.ownsAgent(agent)) return;
        this.captureOne(session, event);
      });
      ctx.on("agent/status", ({ agent, status }) => {
        if (status !== "idle" || !this.ownsAgent(agent)) return;
        const state = this.stateFor(agent);
        if (state.warming) return;
        const done = agent.session.snapshotEvents().some((event) => event.type === "turn/end" && event.data?.reason?.kind === "completed");
        if (!done) return;
        state.warming = true;
        const job = this.finishTurn(agent).finally(() => {
          state.warming = false;
          pendingCuts.delete(job);
        });
        pendingCuts.add(job);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger?.warn?.(`spine: 本会话未接管自动小切。${message}`);
    }
  }

  ownsAgent(agent) {
    // Native preset compaction groups isolate their services from agent.ctx.
    // Bind to the constructor's registration scope, not a later traced ctx.
    if (typeof agent?.ctx?.get !== "function") return true;
    const agentScope = scopeOf(agent.ctx);
    if (this.liveCompactScope !== undefined) {
      return scopeChainOf(agentScope).includes(this.liveCompactScope);
    }
    // Qualified Web/PTC/TUI agents have a preset-scoped engine. A root
    // service inherited by the agent parent must not bypass the isolate.
    // Scoped agents with only a root engine are intentionally unqualified.
    if (agentScope !== undefined) return false;
    return agent.ctx.get("compaction")?.liveCompactIdentity === this.liveCompactIdentity;
  }

  stateFor(agent) {
    const key = sessionKey(agent);
    let state = this.sessionState.get(key);
    if (state) {
      this.sessionState.delete(key);
      this.sessionState.set(key, state);
      return state;
    }
    state = {
      key,
      liveAgent: null,
      warming: false,
      localOnly: false,
      approvedCard: null,
      lastPrefix: "",
      lastPrefixTokens: 0,
      turnBase: null,
      maxTurnGrowth: 0,
    };
    this.sessionState.set(key, state);
    if (this.sessionState.size > MAX_TRACKED_SESSIONS) {
      for (const [oldKey, old] of this.sessionState) {
        if (this.sessionState.size <= MAX_TRACKED_SESSIONS) break;
        if (oldKey === key || old.warming || old.localOnly || old.durabilityUncertain) continue;
        this.sessionState.delete(oldKey);
      }
    }
    return state;
  }

  chunkPlan(session, chunk) {
    const messages = [];
    let on = false;
    for (const seq of session.surface.nodes) {
      if (seq === chunk.start) on = true;
      if (!on) continue;
      messages.push({ role: eventRole(session, seq), content: eventText(session, seq) });
      if (seq === chunk.end) break;
    }
    return planMessages(messages);
  }

  async finishTurn(agent) {
    if (!this.ownsAgent(agent)) return;
    const state = this.stateFor(agent);
    const signal = AbortSignal.timeout(30000);
    try {
      if (state.durabilityUncertain) throw new Error("spine: prior persistence failed; reconcile persisted session state, then restart the isolated Host with a fresh engine before another cut");
      await agent.runMaintenance(async (agentSignal) => {
        const op = AbortSignal.any([agentSignal, signal]);
        const measurement = this.ctx.tokenMeter.measure(agent.session);
        if (measurement.totalTokens < MIN_PRESSURE || measurement.totalTokens >= BIG_GATE) return;
        this.ensurePruneGuard();
        this.captureSession(agent.session);
        const resolved = this.engineFor(agent);
        if (state.engine !== resolved.engine || state.engineSource !== resolved.source) {
          this.ctx.logger?.info?.(`spine engine=${resolved.engine} source=${resolved.source}`);
          state.engine = resolved.engine;
          state.engineSource = resolved.source;
        }
        const cloud = resolved.engine !== "local";
        // 预测下一轮会过 32000 才收尾。实际总量回到 32000 就停，不收到 16000。
        // Drain when the next request would pass 32000. Stop at the measured 32000. Do not cut down to 16000.
        const last = measurement.totalTokens;
        const base = state.turnBase ?? last;
        const growth = Math.max(0, last - base);
        state.maxTurnGrowth = Math.max(state.maxTurnGrowth || 0, growth);
        let drain = cloud && last + state.maxTurnGrowth > KEEP_ROUND_TOKENS;
        for (let pass = 0; pass < 8; pass += 1) {
          const measured = this.ctx.tokenMeter.measure(agent.session);
          if (drain && measured.totalTokens <= KEEP_ROUND_TOKENS) break;
          const chunk = selectNewestChunk(agent.session, measured, state.key, {
            engine: resolved.engine,
            jobs: collectJobs(agent.session.snapshotEvents()),
            calls: indexToolCalls(agent.session.snapshotEvents()),
            rawLookup: (id) => this.rawSeen.get(`${state.key}\0${id}`),
            totalTokens: measured.totalTokens,
            drain,
          });
          if (chunk === null) {
            if (drain && measured.totalTokens > KEEP_ROUND_TOKENS) {
              this.ctx.logger?.warn?.(`spine drain stopped at ${measured.totalTokens}; no legal span`);
            } else {
              this.ctx.logger?.debug?.("spine cut skipped");
            }
            break;
          }
          const tailBeyondKept = chunk.after - (chunk.keptTokens || 0);
          if (!drain && tailBeyondKept > MAX_TAIL && measured.totalTokens < URGENT_TOKENS) break;
          const before = measured.totalTokens;
          const started = Date.now();
          let reduced = false;
          try {
            state.localOnly = true;
            state.approvedCard = chunk.card;
            await this.commitSelectedSpan(agent, chunk, op);
            const after = this.ctx.tokenMeter.measure(agent.session).totalTokens;
            reduced = after < before;
            const saved = before - after;
            const stats = saved > 0 ? recordCutStats(shadowDirectory(), { saved, rewrite: Math.max(0, after - (chunk.prefix || 0)) }) : null;
            const total = stats ? stats.savedTokens : "unknown";
            this.ctx.logger?.info?.(`spine cut ${Date.now() - started}ms ${before} -> ${after} chunk=${chunk.tokens} saved=${saved} total=${total}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.ctx.logger?.warn?.(`spine cut failed: ${message}`);
            if (state.durabilityUncertain) throw error;
            break;
          }
          if (!reduced) {
            this.ctx.logger?.warn?.(`spine cut did not reduce ${before}; leaving the prefix for the gate`);
            break;
          }
          if (!drain) break;
        }
        state.turnBase = this.ctx.tokenMeter.measure(agent.session).totalTokens;
        this.rememberPrefix(agent);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.logger?.warn?.(`spine after-turn skipped: ${message}`);
    } finally {
      state.localOnly = false;
    }
  }

  async commitSelectedSpan(agent, chunk, signal) {
    if (!this.ownsAgent(agent)) throw new Error("spine: agent owns another compaction engine");
    signal?.throwIfAborted();
    const session = agent.session;
    const state = this.stateFor(agent);
    if (state.durabilityUncertain) throw new Error("spine: prior persistence failed; reconcile persisted session state, then restart the isolated Host with a fresh engine before another cut");
    const nodes = session.surface.nodes;
    const startIdx = nodes.indexOf(chunk.start);
    const endIdx = nodes.indexOf(chunk.end);
    if (startIdx < 0 || endIdx < startIdx) throw new Error("spine: selected span is not on the surface");
    if (chunk.card?.ok !== true || !chunk.card.text) throw new Error("spine: approved card missing; leaving the span");
    for (const seq of nodes.slice(startIdx, endIdx + 1)) {
      if (protectedEvent(session, seq)) throw new Error("spine: protected instruction/context cannot be cut");
      if (isCheckpoint(session, seq)) throw new Error("spine: existing checkpoint cannot be cut again");
      const event = session.eventAt(seq);
      if (event?.type === "tool/result") {
        const id = event.data?.message?.toolCallId;
        if (!id || !verifiedRaw(this.rawSeen.get(this.rawKey(session, id))).ok) {
          throw new Error("spine: raw backup unavailable; leaving tool result uncut");
        }
      }
    }
    return compactSurfaceRegion({
      meter: this.ctx.tokenMeter,
      summarize: (input, owner, abort) => this.summarize({ ...input, liveCompact: { card: chunk.card } }, owner, abort),
      // Local deterministic cards do not invoke model/image recovery or retries.
      recover: () => false,
    }, session, chunk.start, chunk.end, agent, {
      owner: null,
      stability: "selected-span",
      flush: async () => {
        try {
          await this.ctx.sessions.flush(session);
        } catch (error) {
          state.durabilityUncertain = true;
          throw error;
        }
      },
    }, signal);
  }

  rememberPrefix(agent) {
    const state = this.stateFor(agent);
    try {
      const messages = agent.session.deriveMessages();
      state.lastPrefix = (messages || []).map(messageText).join("\n");
      state.lastPrefixTokens = this.ctx.tokenMeter.measure(agent.session).totalTokens;
    } catch {}
  }

  async compactIfNeeded(agent, trigger, signal) {
    if (!this.ownsAgent(agent)) return null;
    const state = this.stateFor(agent);
    state.liveAgent = agent;
    state.localOnly = false;
    this.ensurePruneGuard();
    return super.compactIfNeeded(agent, trigger, signal);
  }

  // 请求头往往只有 provider。先读目录里的地址，再对官方 DeepSeek 用公网默认端点。
  // Headers often carry only the provider. Read a catalog URL, then use the public DeepSeek endpoint.
  engineFor(agent) {
    const header = agent?.session?.requestHeader?.()?.config || {};
    const context = agent?.session?.requestContext?.() || {};
    const provider = header.provider || context.provider || "";
    let baseURL = header.baseURL || context.baseURL || "";
    if (!baseURL) {
      try {
        const listed = this.ctx.llm?.listProviders?.() || this.ctx.get?.("llm")?.listProviders?.() || [];
        baseURL = lookupProviderURL(provider, listed);
      } catch {}
    }
    if (!baseURL) baseURL = fallbackProviderURL(provider);
    return resolveEngine({ provider, baseURL });
  }

  rawKey(session, toolCallId) {
    return `${session?.id || DEFAULT_KEY}\0${toolCallId}`;
  }

  captureOne(session, event) {
    const id = event?.data?.message?.toolCallId;
    if (!id) return null;
    const key = session?.id || DEFAULT_KEY;
    const mapKey = this.rawKey(session, id);
    if (this.rawSeen.get(mapKey)?.ok) return this.rawSeen.get(mapKey);
    let call = null;
    try {
      call = indexToolCalls(session.snapshotEvents?.() || []).get(id);
    } catch {}
    try {
      const dir = sessionDir(shadowDirectory(), key);
      const record = captureToolResult({
        root: shadowDirectory(),
        dir,
        toolCallId: id,
        text: messageText(event.data?.message),
        turn: event.data?.turn,
        name: call?.name || "",
        pathLabel: readResultLabel(call?.name, call?.filePath, event.data?.turn),
      });
      this.rawSeen.set(mapKey, record);
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx?.logger?.warn?.(`spine: raw backup failed: ${message}`);
      const record = { ok: false, reason: "unwritable", toolCallId: id };
      this.rawSeen.set(mapKey, record);
      return record;
    }
  }

  captureSession(session) {
    const seen = new Set();
    for (const event of session?.snapshotEvents?.() || []) {
      if (event?.type !== "tool/result") continue;
      const id = event.data?.message?.toolCallId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      this.captureOne(session, event);
    }
    return seen;
  }

  surfaceToolIds(session) {
    const ids = [];
    for (const seq of session?.surface?.nodes || []) {
      const event = session.eventAt?.(seq);
      if (event?.type !== "tool/result") continue;
      const id = event.data?.message?.toolCallId;
      if (id) ids.push(id);
    }
    return ids;
  }

  rawVerifiedSet(session) {
    const prefix = `${session?.id || DEFAULT_KEY}\0`;
    const ids = new Set();
    for (const [mapKey, record] of this.rawSeen) {
      if (!mapKey.startsWith(prefix)) continue;
      if (verifiedRaw(record).ok) ids.add(mapKey.slice(prefix.length));
    }
    return ids;
  }

  ensurePruneGuard() {
    if (this.pruneGuarded) return;
    let pruner;
    try {
      pruner = this.ctx.get("toolResultPruner");
    } catch {
      return;
    }
    if (!pruner?.pruneSession) return;
    pruner.__spineEngine = this;
    if (pruner.pruneSession.__spineGuarded) {
      this.pruneGuarded = true;
      return;
    }
    const original = pruner.pruneSession.bind(pruner);
    function guarded(session) {
      const engine = pruner.__spineEngine;
      engine.captureSession(session);
      const captured = engine.rawVerifiedSet(session);
      if (engine.surfaceToolIds(session).some((id) => !captured.has(id))) {
        engine.ctx.logger?.warn?.("spine: raw backup unavailable; leaving tool results unpruned");
        return { pruned: [], charsRemoved: 0 };
      }
      return original(session);
    }
    guarded.__spineGuarded = true;
    pruner.pruneSession = guarded;
    this.pruneGuarded = true;
  }

  restoreRawMessages(messages, key) {
    return (messages || []).map((message) => {
      const id = message?.toolCallId || message?.message?.toolCallId;
      if (!id) return message;
      return restoreToolText(message, this.rawSeen.get(`${key}\0${id}`));
    });
  }

  saveShadow(messages, required, shadowFile, warnKey = DEFAULT_KEY, protectPaths = []) {
    const root = shadowDirectory();
    const dir = sessionDir(root, warnKey);
    const file = shadowFilePath(shadowFile, warnKey);
    if (dirname(file) !== dir) throw new Error("spine: shadow path is outside this session directory");
    const result = writeShadowFile({
      root, dir, file,
      body: shadowFileBody(warnKey, shadowBody(messages)),
    });
    if (!result.ok) {
      this.ctx.logger?.warn?.(`spine: shadow unavailable (${result.reason}); leaving the span`);
      if (required) throw new Error(`spine: shadow backup unavailable (${result.reason}); leaving the span`);
      return;
    }
    return result;
  }

  async summarize(input, agent, signal) {
    const decision = takeLocalCut(input?.liveCompact);
    const state = this.stateFor(agent);
    state.approvedCard = null;
    if (decision.kind === "refuse") throw new Error(decision.reason);
    if (decision.kind === "local") {
      const card = input?.liveCompact?.card;
      if (card?.needsBackup && !card.shadowFile) throw new Error("spine: omit refused; backup path missing");
      // The native replay helper includes the system head for model summaries.
      // A local card backs up only the selected visible history, not that head.
      const restored = this.restoreRawMessages(input.messages.filter((message) => !protectedMessage(message)), state.key);
      this.saveShadow(restored, true, card?.shadowFile, state.key, card?.rawPaths || []);
      if (card?.needsBackup && !existsSync(card.shadowFile)) throw new Error("spine: shadow backup was not written");
      const text = backupClaimOk(restored) ? decision.text : withoutFullBackupClaim(decision.text, card?.shadowFile);
      const block = { type: "text", text };
      return { summary: [block], provider: "local", model: "spine-extract", rawOutput: [block] };
    }
    try {
      this.saveShadow(this.restoreRawMessages(input.messages, state.key), false, freshShadowFile("official", state.key), state.key);
    } catch {}
    const joined = input.messages.map(messageText).join("\n\n");
    if (process.env.SPINE_THUNDER !== "1" || input.messages.some(protectedMessage)) return super.summarize(input, agent, signal);
    const next = joined;
    const mode = decideThunder({
      previous: state.lastPrefix || "",
      next,
      modelKind: process.env.SPINE_THUNDER_MODEL === "27b" ? "27b" : "flash",
      prefixTokens: state.lastPrefixTokens || 0,
    });
    if (mode === "attach") return super.summarize(input, agent, signal);
    const users = input.messages.filter((message) => (message?.role ?? message?.message?.role) === "user");
    const taskLine = messageText(users.at(-1) || input.messages.at(-1)).slice(0, 500);
    const trunk = buildCard(joined, "", input.messages.map((message) => ({
      role: message?.role ?? message?.message?.role,
      text: messageText(message),
    })));
    const facts = [...new Set([...(trunk.hardLines || []), ...(trunk.missing || [])])];
    const slim = buildSendLess({ taskLine, uncovered: trunk.uncovered, facts });
    return super.summarize({
      ...input,
      messages: [{ role: "user", content: [{ type: "text", text: slim }] }],
    }, agent, signal);
  }
}
