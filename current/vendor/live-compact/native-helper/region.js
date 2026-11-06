// Vendored rc5 transaction helper. See PROVENANCE.md and LICENSE.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CompactionId, ManualCompactionError, compactCheckpointSource, toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction';
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { frameSummary } from './frame.js';
class SurfaceChangedError extends Error {
}
function systemHead(session, headSeq) {
    const head = session.eventAt(headSeq);
    return head.type === 'system/message' ? head : undefined;
}
export async function compactSurfaceRegion(dependencies, session, start, end, agent, options, signal) {
    if (options.owner === null) signal?.throwIfAborted();
    const selection = validateSurfaceRegion(session, start, end);
    const entryState = inspectCompactionEntryState(session);
    assertCompactionInactive(entryState.unmatchedCompactionStart, entryState.latestEndSeedSeq, 'compaction');
    let owner;
    if (options.owner === null) {
        if (entryState.openTurn !== null) {
            throw new ManualCompactionError('busy', 'manual compaction: the session already has an open turn');
        }
        owner = null;
    } else {
        if (entryState.openTurn === null) {
            throw new Error('compactRegion: no open turn — automatic compaction events must be enclosed in a turn');
        }
        owner = entryState.openTurn;
    }
    const compactionId = CompactionId(randomUUID());
    const lifecycle = {
        compactionId,
        ...options.sourceCommandId === undefined ? {} : {
            sourceCommandId: options.sourceCommandId
        },
        turn: owner
    };
    const startEvent = session.append('compaction/start', lifecycle);
    const assertStable = options.stability === 'whole-surface' ? assertWholeSurfaceUnchanged : assertSelectedSpanStable;
    let failure;
    let flushFailure;
    let result;
    let closed = false;
    let closing = false;
    let stage = 'summary';
    try {
        const prepared = prepareCompaction(dependencies, session, selection);
        const summarized = await summarizeCompaction(dependencies, prepared, agent, compactionId, options.sourceCommandId, assertStable, signal);
        if (options.owner === null) signal?.throwIfAborted();
        assertStable(dependencies, session, summarized);
        stage = 'commit';
        const pending = commitCompactionBody(session, startEvent, summarized);
        closing = true;
        const endEvent = session.append('compaction/end', lifecycle);
        closed = true;
        result = completeCompaction(pending, endEvent);
    } catch (error) {
        failure = {
            error,
            stage: closing ? 'commit' : stage
        };
        if (!closing) {
            closing = true;
            try {
                session.append('compaction/end', {
                    ...lifecycle,
                    error: errorChain(error)
                });
                closed = true;
            } catch (closeError) {
                failure = {
                    error: closeError,
                    stage: 'commit'
                };
            }
        }
    }
    if (closed && options.flush !== undefined) {
        try {
            await options.flush();
        } catch (error) {
            flushFailure = error;
        }
    }
    if (options.owner === null) signal?.throwIfAborted();
    if (failure !== undefined) {
        if (options.owner === null) throwManualFailure(failure);
        throw failure.error;
    }
    if (flushFailure !== undefined) {
        throw new ManualCompactionError('persistence', 'manual compaction durability checkpoint failed', {
            cause: flushFailure
        });
    }
    if (result === undefined) throw new Error('compaction committed without a result');
    return result;
}
function throwManualFailure(failure) {
    if (failure.stage === 'commit') {
        throw new ManualCompactionError('commit', 'manual compaction did not commit cleanly', {
            cause: failure.error
        });
    }
    if (failure.error instanceof SurfaceChangedError) {
        throw new ManualCompactionError('changed', 'the compacted history changed during manual compaction', {
            cause: failure.error
        });
    }
    throw new ManualCompactionError('summary', 'manual compaction could not produce a smaller summary', {
        cause: failure.error
    });
}
function assertCompactionInactive(unmatchedCompactionStart, latestEndSeedSeq, stage) {
    if (unmatchedCompactionStart === undefined || latestEndSeedSeq !== undefined && latestEndSeedSeq > unmatchedCompactionStart.seq) return;
    throw new ManualCompactionError('busy', `${stage}: compaction already in progress; the session compaction lock is already active`);
}
function validateSurfaceRegion(session, start, end) {
    const nodes = session.surface.nodes;
    const startIdx = nodes.indexOf(start);
    const endIdx = nodes.indexOf(end);
    if (startIdx === -1) throw new Error(`compactRegion: start seq ${start} not found in surface`);
    if (endIdx === -1) throw new Error(`compactRegion: end seq ${end} not found in surface`);
    if (startIdx > endIdx) {
        throw new Error(`compactRegion: start seq ${start} (position ${startIdx}) is after end seq ${end} (position ${endIdx}) on the surface`);
    }
    if (!toolPairingBalancedBefore(session, nodes[startIdx])) {
        throw new Error(`compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`);
    }
    if (!toolPairingBalancedAfter(session, nodes[endIdx])) {
        throw new Error(`compactRegion: end seq ${end} is not a balanced boundary (would split a step, or the step is still open)`);
    }
    return {
        start,
        end,
        startIdx,
        endIdx,
        shadowedSeqs: nodes.slice(startIdx, endIdx + 1)
    };
}
function prepareCompaction(dependencies, session, selection) {
    const measurement = dependencies.meter.measure(session);
    const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1);
    if (selectedNodes.length !== selection.shadowedSeqs.length || selectedNodes.some((node, index)=>node.seq !== selection.shadowedSeqs[index])) {
        throw new SurfaceChangedError('compaction: selected surface changed before summarization began');
    }
    return {
        ...selection,
        measurement,
        selectedNodes,
        shadowedTokenCount: selectedNodes.reduce((total, node)=>total + node.heuristicTokens, 0),
        shadowedRouteTokenCount: selectedNodes.reduce((total, node)=>total + node.tokens, 0),
        input: buildSummarizationInput(session, selection.shadowedSeqs)
    };
}
async function summarizeCompaction(dependencies, prepared, agent, compactionId, sourceCommandId, assertStable, signal) {
    let summaryResult;
    for(;;){
        signal?.throwIfAborted();
        try {
            summaryResult = await dependencies.summarize(prepared.input, agent, signal);
            break;
        } catch (error) {
            if (signal?.aborted === true) throw error;
            assertStable(dependencies, agent.session, prepared);
            if (!dependencies.recover(error, agent, prepared.shadowedSeqs, signal)) throw error;
            prepared = prepareCompaction(dependencies, agent.session, validateSurfaceRegion(agent.session, prepared.start, prepared.end));
        }
    }
    const checkpointMessage = createUserMessage({
        content: frameSummary(summaryResult.summary),
        source: compactCheckpointSource(compactionId, sourceCommandId)
    });
    const framedSummaryTokenCount = dependencies.meter.estimateMessage(checkpointMessage);
    if (framedSummaryTokenCount >= prepared.shadowedRouteTokenCount) {
        throw new Error(`summary is not smaller than the shadowed content (${framedSummaryTokenCount} estimated framed tokens >= ${prepared.shadowedRouteTokenCount})`);
    }
    return {
        ...prepared,
        ...summaryResult,
        checkpointMessage
    };
}
function assertWholeSurfaceUnchanged(dependencies, session, prepared) {
    const current = dependencies.meter.measure(session);
    if (!isDeepStrictEqual(current.nodes, prepared.measurement.nodes)) {
        throw new SurfaceChangedError('compaction: session surface changed during summarization');
    }
}
function assertSelectedSpanStable(dependencies, session, prepared) {
    let current;
    try {
        current = validateSurfaceRegion(session, prepared.start, prepared.end);
    } catch (error) {
        throw new SurfaceChangedError('compaction: the selected span is no longer a valid replacement target', {
            cause: error
        });
    }
    if (!isDeepStrictEqual([
        ...current.shadowedSeqs
    ], [
        ...prepared.shadowedSeqs
    ])) {
        throw new SurfaceChangedError('compaction: the selected span changed during summarization');
    }
    const measured = dependencies.meter.measure(session).nodes.slice(current.startIdx, current.endIdx + 1);
    if (!isDeepStrictEqual(measured, prepared.selectedNodes)) {
        throw new SurfaceChangedError('compaction: the selected span was rewritten during summarization');
    }
}
function commitCompactionBody(session, startEvent, summarized) {
    const { start, end, shadowedSeqs, shadowedTokenCount, summary, provider, model, maxTokens, usage, checkpointMessage } = summarized;
    const callRecord = summarized.llmStreamCall === true ? {
        rawOutput: summarized.rawOutput,
        llmStreamCall: true
    } : summarized.rawOutput === undefined ? {} : {
        rawOutput: summarized.rawOutput
    };
    const summaryEvent = session.append('compaction/summary', {
        compactionId: startEvent.data.compactionId,
        ...startEvent.data.sourceCommandId === undefined ? {} : {
            sourceCommandId: startEvent.data.sourceCommandId
        },
        summary,
        ...callRecord,
        shadowedRange: {
            start,
            end
        },
        shadowedSeqs: [
            ...shadowedSeqs
        ],
        shadowedTokenCount,
        provider,
        model,
        ...maxTokens === undefined ? {} : {
            maxTokens
        },
        ...usage === undefined ? {} : {
            usage
        }
    });
    session.append('user/message', checkpointMessage, {
        surfaceOp: {
            op: 'replace',
            startSeq: start,
            endSeq: end
        },
        sourceEventSeqs: [
            startEvent.seq,
            summaryEvent.seq,
            ...shadowedSeqs
        ]
    });
    return {
        compactionId: startEvent.data.compactionId,
        ...startEvent.data.sourceCommandId === undefined ? {} : {
            sourceCommandId: startEvent.data.sourceCommandId
        },
        startSeq: startEvent.seq,
        summarySeq: summaryEvent.seq,
        summary,
        shadowedRange: {
            start,
            end
        },
        shadowedSeqs: [
            ...shadowedSeqs
        ],
        shadowedTokenCount
    };
}
function completeCompaction(pending, endEvent) {
    return {
        ...pending,
        endSeq: endEvent.seq
    };
}
function buildSummarizationInput(session, shadowedSeqs) {
    const header = session.requestHeader();
    const head = systemHead(session, session.surface.nodes[0]);
    const system = head === undefined ? null : session.deriveEventMessage(head);
    const regionMessages = shadowedSeqs.map((seq)=>session.deriveEventMessage(session.eventAt(seq))).filter((message)=>message !== null);
    return {
        ...header?.tools === undefined ? {} : {
            tools: header.tools
        },
        messages: system === null ? regionMessages : [
            system,
            ...regionMessages
        ]
    };
}
function inspectCompactionEntryState(session) {
    let openTurn = null;
    let openTurnStateKnown = false;
    let unmatchedCompactionStart;
    let compactionEntryStateKnown = false;
    let latestEndSeedSeq;
    for(let seq = session.seq - 1; seq >= 0; seq -= 1){
        const event = session.eventAt(SessionSeq(seq));
        if (latestEndSeedSeq === undefined && event.type === 'session/end-seed') {
            latestEndSeedSeq = event.seq;
        }
        if (!compactionEntryStateKnown) {
            if (event.type === 'compaction/start') {
                unmatchedCompactionStart = event;
                compactionEntryStateKnown = true;
            } else if (event.type === 'compaction/end') {
                compactionEntryStateKnown = true;
            }
        }
        if (!openTurnStateKnown) {
            if (event.type === 'turn/start') {
                openTurn = event.data.turn;
                openTurnStateKnown = true;
            } else if (event.type === 'turn/end') {
                openTurnStateKnown = true;
            }
        }
        if (openTurnStateKnown && compactionEntryStateKnown && latestEndSeedSeq !== undefined) break;
    }
    return {
        openTurn,
        unmatchedCompactionStart,
        latestEndSeedSeq
    };
}
