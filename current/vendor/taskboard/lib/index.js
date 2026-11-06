import { executionPrompt, executionState, boardCommand } from './local-workflow.js';
import z from "schemastery";
import { spawn, spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, win32 } from "node:path";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute$1, join as join$1 } from "node:path/posix";
import { SVC, isTurnEnd, service } from "../lib/host-adapter.js";
//#region src/core/schedule.ts
/** Inclusive ranges per field, in cron order. */
const FIELD_RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7]
];
/**
* Parse a 5-field cron expression.
* @returns the match sets, or null when the expression is invalid.
*/
function parseCron(expr) {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const sets = [];
	for (let index = 0; index < 5; index++) {
		const [min, max] = FIELD_RANGES[index];
		const set = /* @__PURE__ */ new Set();
		if (!parseField(fields[index], min, max, set)) return null;
		sets.push(set);
	}
	const weekdays = /* @__PURE__ */ new Set();
	for (const day of sets[4]) weekdays.add(day === 7 ? 0 : day);
	return {
		minutes: sets[0],
		hours: sets[1],
		days: sets[2],
		months: sets[3],
		weekdays,
		dayWildcard: fields[2] === "*",
		weekdayWildcard: fields[4] === "*"
	};
}
/** Whether the expression parses. */
function isValidCron(expr) {
	return parseCron(expr) !== null;
}
/**
* Compute the next matching instant after `fromMs` (ms epoch), in local time,
* at minute granularity, strictly greater than `fromMs`. Returns the ms epoch
* of the matching minute's start, or undefined when the calendar constraint
* can never match (for example `0 0 30 2 *`). The five-year horizon includes
* a full leap cycle, so a valid February 29 schedule remains reachable from
* every non-leap year.
*
* Walks candidate year/month/day/hour/minute values straight from the parsed
* field sets instead of scanning every minute: a sparse expression such as
* `0 0 29 2 *` used to iterate ~1.5M wall-clock minutes before reaching the
* next leap day. Wall-clock field construction + the final `matches` re-check
* preserve the old minute scan's DST semantics exactly (nonexistent spring
* minutes normalize forward and the repeated fall-back hour is never visited).
*/
function nextRunAtMs(expr, fromMs) {
	const schedule = parseCron(expr);
	if (schedule === null) return void 0;
	if (!hasPossibleCalendarDay(schedule)) return void 0;
	const from = new Date(fromMs);
	const limitMs = fromMs + 5 * 366 * 24 * 60 * 60 * 1e3;
	const sortedMinutes = [...schedule.minutes].sort((a, b) => a - b);
	const sortedHours = [...schedule.hours].sort((a, b) => a - b);
	const sortedMonths = [...schedule.months].sort((a, b) => a - b);
	let year = from.getFullYear();
	let month = from.getMonth() + 1;
	let day = from.getDate();
	let hour = from.getHours();
	let minute = from.getMinutes() + 1;
	while (new Date(year, month - 1, 1, 0, 0, 0, 0).getTime() <= limitMs) {
		for (const candidateMonth of sortedMonths) {
			if (candidateMonth < month) continue;
			const daysInMonth = new Date(year, candidateMonth, 0).getDate();
			const dayStart = candidateMonth === month ? day : 1;
			for (let candidateDay = dayStart; candidateDay <= daysInMonth; candidateDay += 1) {
				if (!dayCandidate(schedule, new Date(year, candidateMonth - 1, candidateDay, 0, 0, 0, 0))) continue;
				const hourStart = candidateMonth === month && candidateDay === day ? hour : 0;
				for (const candidateHour of sortedHours) {
					if (candidateHour < hourStart) continue;
					const minuteStart = candidateMonth === month && candidateDay === day && candidateHour === hour ? minute : 0;
					for (const candidateMinute of sortedMinutes) {
						if (candidateMinute < minuteStart) continue;
						const candidate = new Date(year, candidateMonth - 1, candidateDay, candidateHour, candidateMinute, 0, 0);
						const time = candidate.getTime();
						if (time <= fromMs) continue;
						if (time > limitMs) return void 0;
						if (matches(schedule, candidate)) return time;
					}
				}
			}
		}
		year += 1;
		month = 1;
		day = 1;
		hour = 0;
		minute = 0;
	}
}
/** Day/weekday OR gate shared by {@link matches} and the candidate scan. */
function dayCandidate(schedule, date) {
	const dayMatches = schedule.days.has(date.getDate());
	const weekdayMatches = schedule.weekdays.has(date.getDay());
	if (schedule.dayWildcard) return weekdayMatches;
	if (schedule.weekdayWildcard) return dayMatches;
	return dayMatches || weekdayMatches;
}
/** Reject impossible month/day pairs without spending the multi-year scan. */
function hasPossibleCalendarDay(schedule) {
	if (schedule.dayWildcard || !schedule.weekdayWildcard) return true;
	const maximumDay = /* @__PURE__ */ new Map([
		[1, 31],
		[2, 29],
		[3, 31],
		[4, 30],
		[5, 31],
		[6, 30],
		[7, 31],
		[8, 31],
		[9, 30],
		[10, 31],
		[11, 30],
		[12, 31]
	]);
	for (const month of schedule.months) {
		const maximum = maximumDay.get(month) ?? 0;
		if ([...schedule.days].some((day) => day <= maximum)) return true;
	}
	return false;
}
/** Parse one comma-list field into the match set. */
function parseField(field, min, max, out) {
	if (field === "*") {
		for (let value = min; value <= max; value++) out.add(value);
		return true;
	}
	for (const part of field.split(",")) {
		if (part === "") return false;
		const [range, stepRaw] = part.split("/");
		let low;
		let high;
		if (range === "*") {
			low = min;
			high = max;
		} else if (range.includes("-")) {
			const [a, b] = range.split("-");
			if (a === "" || b === "" || !isDigits(a) || !isDigits(b)) return false;
			low = Number(a);
			high = Number(b);
		} else if (isDigits(range)) {
			low = Number(range);
			high = Number(range);
		} else return false;
		if (low < min || high > max || low > high) return false;
		const step = stepRaw === void 0 ? 1 : isDigits(stepRaw) ? Number(stepRaw) : NaN;
		if (!Number.isInteger(step) || step < 1) return false;
		for (let value = low; value <= high; value += step) out.add(value);
	}
	return true;
}
/** Day/weekday OR semantics: a restricted day field alone gates, and vice versa. */
function matches(schedule, date) {
	if (!schedule.minutes.has(date.getMinutes())) return false;
	if (!schedule.hours.has(date.getHours())) return false;
	if (!schedule.months.has(date.getMonth() + 1)) return false;
	return dayCandidate(schedule, date);
}
function isDigits(value) {
	return /^\d+$/.test(value);
}
//#endregion
//#region src/dsh-home.ts
/**
* DSH_HOME resolution shared by the plugin family's Host halves: the
* environment override wins, the platform home fallback follows. Mirrors
* what dsh-pet and dsh-liangshen each used to implement locally.
*/
/** Expand a leading ~ (or ~user) in a path, platform-style. */
function expandHome(path, home = homedir()) {
	const j = home.startsWith("/") ? join$1 : join;
	if (path === "~") return home;
	if (path.startsWith("~/") || path.startsWith("~\\")) return j(home, path.slice(2));
	return path;
}
/**
* Resolve the DSH home directory.
* @param env - process environment to read DSH_HOME from.
* @param home - platform home directory fallback (test seam).
* @returns the absolute DSH home path.
*/
function resolveDshHome(env = process.env, home = homedir()) {
	const isPosix = home.startsWith("/");
	const j = isPosix ? join$1 : join;
	const isAbs = isPosix ? isAbsolute$1 : isAbsolute;
	const raw = env.DSH_HOME;
	if (raw !== void 0 && raw.trim() !== "") {
		const expanded = expandHome(raw.trim(), home);
		return isAbs(expanded) ? expanded : j(process.cwd(), expanded);
	}
	return j(home, ".dsh");
}
/** Resolve the DSH home directory from the live environment. */
function dshHome() {
	return resolveDshHome();
}
//#endregion
//#region src/core/tasks.ts
/** All valid task kinds (closed union guard). */
const ALL_KINDS = [
	"once",
	"recurring",
	"interactive"
];
/** Whether an unknown value is a known task kind. */
function isTaskKind(value) {
	return typeof value === "string" && ALL_KINDS.includes(value);
}
/**
* Trim an execution list to at most {@link EXECUTION_HISTORY_LIMIT} records,
* most recent last. A running (unsettled) execution is never trimmed: the
* Host monitor and restart recovery depend on the active record, and a task
* cannot start a new run while one is still open.
*/
function retainRecentExecutions(executions) {
	if (executions.length <= 20) return [...executions];
	const open = executions.filter((execution) => execution.endedAt === void 0);
	const settled = executions.filter((execution) => execution.endedAt !== void 0);
	const keepSettled = Math.max(20 - open.length, 0);
	return [...settled.slice(Math.max(settled.length - keepSettled, 0)), ...open];
}
/** Statuses a settled task may be archived from. */
const ARCHIVABLE_STATUSES = ["done", "failed"];
/** Permission presets a task may pin on its execution session (the `/permission <id>` ids). */
const TASK_PERMISSIONS = [
	"read-only",
	"workspace-write",
	"danger-full-access"
];
/** Whether an unknown value is a known permission preset id. */
function isTaskPermission(value) {
	return typeof value === "string" && TASK_PERMISSIONS.includes(value);
}
/**
* Statuses a user may move a card to manually. `done` is included so a human
* can close an `interactive` card (which never runs through the acceptance
* gate); the execution states `running`/`review` stay owned by the runner and
* the confirm/reject actions.
*/
const MANUAL_STATUSES = [
	"backlog",
	"todo",
	"done"
];
/** All valid statuses (closed union guard). */
const ALL_STATUSES = [
	"backlog",
	"todo",
	"running",
	"review",
	"done",
	"failed"
];
/** Brand an unknown string as a status; undefined when it is not one. */
function isTaskStatus(value) {
	return typeof value === "string" && ALL_STATUSES.includes(value);
}
/**
* Whether a manual move target is allowed from the given status. The runner
* owns `running`; a card parked in `review` may still be dragged (confirm and
* reject are the primary path, a manual move is the escape hatch).
*/
function canMoveManually(from, to) {
	return from !== "running" && MANUAL_STATUSES.includes(to);
}
/** Normalize one optional execution-target string: trim; blank collapses to undefined. */
function normalizeTargetId(value) {
	const trimmed = value?.trim();
	return trimmed === void 0 || trimmed === "" ? void 0 : trimmed;
}
/** Create a task from user input. */
function createTask(input, now, id) {
	return {
		id,
		title: input.title.trim(),
		description: input.description.trim(),
		prompt: input.prompt.trim(),
		status: "todo",
		createdAt: now,
		updatedAt: now,
		executions: [],
		workspaceId: normalizeTargetId(input.workspaceId),
		mode: normalizeTargetId(input.mode),
		permission: isTaskPermission(input.permission) ? input.permission : void 0,
		kind: isTaskKind(input.kind) ? input.kind : input.schedule?.enabled === true ? "recurring" : "once",
		line: normalizeTargetId(input.line),
		seq: normalizeTargetId(input.seq)
	};
}
/** Clone a task with an updated status and a fresh updatedAt. */
function withStatus(task, status, now) {
	return {
		...task,
		status,
		updatedAt: now
	};
}
/**
* Merge a schedule patch into a task's schedule rule (creating it when
* absent), with a fresh updatedAt. Keys present in the patch overwrite the
* current value — including explicit `undefined`, which clears a field (used
* to disarm `nextRunAt`); absent keys keep their current value.
*/
function withSchedule(task, patch, now) {
	const current = task.schedule;
	const schedule = {
		enabled: current?.enabled ?? false,
		cron: current?.cron ?? "",
		nextRunAt: current?.nextRunAt,
		lastTriggeredAt: current?.lastTriggeredAt
	};
	if ("enabled" in patch) schedule.enabled = patch.enabled ?? false;
	if ("cron" in patch) schedule.cron = patch.cron ?? "";
	if ("nextRunAt" in patch) schedule.nextRunAt = patch.nextRunAt;
	if ("lastTriggeredAt" in patch) schedule.lastTriggeredAt = patch.lastTriggeredAt;
	return {
		...task,
		updatedAt: now,
		schedule
	};
}
/**
* Open a fresh execution on a task: move it to 'running' and append a
* running execution record. Returns the new task and the new execution.
*/
function startExecution(task, now, executionId) {
	const execution = {
		id: executionId,
		sessionId: void 0,
		startedAt: now,
		endedAt: void 0,
		result: void 0,
		error: void 0
	};
	return {
		task: {
			...task,
			status: "running",
			updatedAt: now,
			executions: retainRecentExecutions([...task.executions, execution])
		},
		execution
	};
}
/**
* Settle a running execution: record the outcome and move the task into the
* matching column. A successful turn parks the card in `review` — the local
* fork's human acceptance gate: "the session's turn ended" is not "the work is
* done", so a human must confirm or reject. No-op (returns the input task)
* when the execution is not the task's latest or is already settled.
*
* `interrupted` (card [Q3]) behaves like `cancelled`: the card returns to
* `todo` with the interruption recorded on the execution, so a restart can
* never park unfinished work in 待验收.
*/
function settleExecution(task, executionId, outcome, now, error) {
	const index = task.executions.findIndex((execution) => execution.id === executionId);
	if (index === -1) return task;
	const execution = task.executions[index];
	if (execution.endedAt !== void 0) return task;
	const settled = {
		...execution,
		endedAt: now,
		result: outcome,
		error
	};
	const executions = [...task.executions];
	executions[index] = settled;
	const status = outcome === "succeeded" ? "review" : outcome === "failed" ? "failed" : task.status === "running" ? "todo" : task.status;
	return {
		...task,
		status,
		updatedAt: now,
		executions
	};
}
/**
* The effective kind of a card: an explicit `kind` wins; a ledger row written
* before the local fork infers `recurring` when it carries a schedule and
* `once` otherwise.
*/
function taskKind(task) {
	return isTaskKind(task.kind) ? task.kind : task.schedule !== void 0 ? "recurring" : "once";
}
/** Whether the card is a cron-driven recurring job. */
function isRecurringTask(task) {
	return taskKind(task) === "recurring";
}
/** Whether the card requires a human in the driver's seat (it refuses a schedule). */
function isInteractiveTask(task) {
	return taskKind(task) === "interactive";
}
/**
* The column a confirmed card lands in: a recurring job returns to `todo` so
* it stays on the board for its next trigger; everything else is `done`.
*/
function confirmedStatus(task) {
	return isRecurringTask(task) ? "todo" : "done";
}
//#endregion
//#region src/core/store.ts
/**
* Legacy v1 browser persistence and the store seam used by pure client tests.
*
* Production v2 state is Host-authoritative. This backend is retained only to
* read `dsh.taskBoard.v1` for one-time import; the old value is never removed,
* so it remains a read-only rollback copy after migration.
*
* The seam keeps the backend swappable (e.g. an IndexedDB or a host-file
* channel later); tests run against the in-memory backend and a jsdom
* localStorage backend.
*/
/**
* Structural row check with the status left unvalidated (see {@link parseLedger}).
* The `schedule` field is deliberately NOT checked here: a malformed schedule
* never drops the task row — {@link normalizeSchedule} repairs or drops the
* schedule alone.
*/
function isTaskRecordShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	if (typeof record.id !== "string" || record.id === "") return false;
	if (typeof record.title !== "string") return false;
	if (typeof record.description !== "string") return false;
	if (typeof record.prompt !== "string") return false;
	if (typeof record.createdAt !== "number") return false;
	if (typeof record.updatedAt !== "number") return false;
	if (record.workspaceId !== void 0 && typeof record.workspaceId !== "string") return false;
	if (record.mode !== void 0 && typeof record.mode !== "string") return false;
	if (record.permission !== void 0 && typeof record.permission !== "string") return false;
	if (record.kind !== void 0 && typeof record.kind !== "string") return false;
	if (record.line !== void 0 && typeof record.line !== "string") return false;
	if (record.seq !== void 0 && typeof record.seq !== "string") return false;
	if (!Array.isArray(record.executions)) return false;
	for (const execution of record.executions) {
		if (typeof execution !== "object" || execution === null) return false;
		const entry = execution;
		if (typeof entry.id !== "string") return false;
		if (entry.sessionId !== void 0 && typeof entry.sessionId !== "string") return false;
		if (typeof entry.startedAt !== "number") return false;
		if (entry.endedAt !== void 0 && typeof entry.endedAt !== "number") return false;
		if (entry.result !== void 0 && entry.result !== "succeeded" && entry.result !== "failed" && entry.result !== "cancelled" && entry.result !== "interrupted") return false;
		if (entry.error !== void 0 && typeof entry.error !== "string") return false;
	}
	return true;
}
/** Normalize an unknown persisted status back into the closed status union. */
function normalizeStatus(status) {
	return isTaskStatus(status) ? status : "todo";
}
/**
* Normalize an unknown persisted kind: a valid kind is kept, an unknown or
* missing one collapses to undefined so {@link taskKind} can infer it from
* the schedule (legacy rows).
*/
function normalizeKind(kind) {
	return isTaskKind(kind) ? kind : void 0;
}
/**
* Repair a persisted schedule rule: drop rules without a usable cron string,
* coerce booleans/numbers, and leave `nextRunAt`/`lastTriggeredAt` undefined
* when missing (a fresh recompute or the next tick fixes them).
*/
function normalizeSchedule(schedule) {
	if (typeof schedule !== "object" || schedule === null) return void 0;
	const rule = schedule;
	if (typeof rule.cron !== "string") return void 0;
	if (rule.cron.trim() === "" || !isValidCron(rule.cron)) return void 0;
	return {
		enabled: rule.enabled === true,
		cron: rule.cron,
		nextRunAt: typeof rule.nextRunAt === "number" ? rule.nextRunAt : void 0,
		lastTriggeredAt: typeof rule.lastTriggeredAt === "number" ? rule.lastTriggeredAt : void 0
	};
}
/** Parse + validate a persisted ledger document; invalid rows are dropped. */
function parseLedger(raw) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted task ledger is not valid JSON; starting empty", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted task ledger is not an array; starting empty");
		return [];
	}
	const tasks = [];
	for (const row of parsed) {
		if (!isTaskRecordShape(row)) {
			console.warn("[dsh-task-board] dropping invalid task row from persisted ledger", row);
			continue;
		}
		const task = {
			...row,
			status: normalizeStatus(row.status)
		};
		task.schedule = normalizeSchedule(row.schedule);
		task.workspaceId = normalizeTargetId(row.workspaceId);
		task.mode = normalizeTargetId(row.mode);
		task.archivedAt = typeof row.archivedAt === "number" && Number.isFinite(row.archivedAt) ? row.archivedAt : void 0;
		task.permission = isTaskPermission(row.permission) ? row.permission : void 0;
		task.kind = normalizeKind(row.kind);
		task.line = normalizeTargetId(row.line);
		task.seq = normalizeTargetId(row.seq);
		tasks.push(task);
	}
	return tasks;
}
//#endregion
//#region src/core/use-cases/task-archive.ts
/**
* Archive one task: only settled statuses (done/failed) can be archived;
* a running or not-yet-settled task stays on the board (its runner still
* owns its lifecycle). Archiving disarms a schedule; already-archived tasks
* are a no-op.
*/
function applyArchiveTask(tasks, id, now) {
	let applied = false;
	return {
		tasks: tasks.map((task) => {
			if (task.id !== id || task.archivedAt !== void 0) return task;
			if (!ARCHIVABLE_STATUSES.includes(task.status)) return task;
			applied = true;
			const schedule = task.schedule === void 0 ? void 0 : {
				...task.schedule,
				enabled: false,
				nextRunAt: void 0
			};
			return {
				...task,
				...schedule === void 0 ? {} : { schedule },
				archivedAt: now,
				updatedAt: now
			};
		}),
		archived: applied
	};
}
/** Restore one task back onto the main board (clears the archive marker). */
function applyRestoreTask(tasks, id, now) {
	let applied = false;
	return {
		tasks: tasks.map((task) => {
			if (task.id !== id || task.archivedAt === void 0) return task;
			applied = true;
			const { archivedAt: _archived, ...rest } = task;
			return {
				...rest,
				updatedAt: now
			};
		}),
		archived: applied
	};
}
//#endregion
//#region src/core/use-cases/task-create.ts
/**
* Create-task use case: mint a new task from user input, rejecting a blank
* title. Pure ledger transition (no persistence or notify — the controller
* orchestrates those), so it is unit-testable without any runtime face.
*/
/**
* Apply a create against the current ledger. Returns the new task and the
* appended ledger, or the unchanged ledger when the title is blank.
* @param tasks - current ledger.
* @param input - raw user input (title/description/prompt + optional schedule).
* @param now - clock instant (ms epoch).
* @param id - minted task id.
*/
function applyCreateTask(tasks, input, now, id) {
	if (input.title.trim() === "") return {
		task: void 0,
		tasks
	};
	let task = createTask(input, now, id);
	const requested = input.schedule;
	if (requested?.enabled === true && requested.cron.trim() !== "" && isValidCron(requested.cron)) {
		const cron = requested.cron.trim();
		task = withSchedule(task, {
			enabled: true,
			cron,
			nextRunAt: nextRunAtMs(cron, now)
		}, now);
	}
	return {
		task,
		tasks: [...tasks, task]
	};
}
//#endregion
//#region src/core/use-cases/task-delete.ts
/**
* Apply a delete across the ledger. The selection (a task id) is cleared when
* it matches the removed task, so the UI never lingers on a vanished detail.
* @param tasks - current ledger.
* @param selectedTaskId - the currently selected task id (may be undefined).
* @param id - the task to remove.
*/
function applyDeleteTask(tasks, selectedTaskId, id) {
	return {
		tasks: tasks.filter((task) => task.id !== id),
		selectionCleared: selectedTaskId === id
	};
}
//#endregion
//#region src/core/use-cases/task-schedule.ts
/**
* Schedule use case: arm/disarm a task's cron rule and roll a rule forward.
* Pure ledger transitions (no persistence or notify — the controller
* orchestrates those). Validation and next-run computation live here, sharing
* the core cron parser (schedule.ts) and the withSchedule transition.
*/
/**
* Set an on-board task's schedule rule. A blank or invalid cron, or an
* archived task, is rejected (state untouched); an enabled rule computes the
* next run instant immediately, a disabled one carries no next-run instant.
* @param tasks - current ledger.
* @param id - the task to schedule.
* @param patch - rule fields to change (absent fields keep their current value).
* @param now - clock instant (ms epoch).
*/
function applySetSchedule(tasks, id, patch, now) {
	const task = tasks.find((candidate) => candidate.id === id);
	if (task === void 0 || task.archivedAt !== void 0) return {
		tasks,
		applied: false
	};
	const current = task.schedule;
	const cron = (patch.cron ?? current?.cron ?? "").trim();
	if (cron === "" || !isValidCron(cron)) return {
		tasks,
		applied: false
	};
	const enabled = patch.enabled ?? current?.enabled ?? false;
	const nextRunAt = enabled ? nextRunAtMs(cron, now) : void 0;
	if (enabled && nextRunAt === void 0) return {
		tasks,
		applied: false
	};
	return {
		tasks: tasks.map((candidate) => candidate.id === id ? withSchedule(candidate, {
			enabled,
			cron,
			nextRunAt
		}, now) : candidate),
		applied: true
	};
}
/**
* Roll a task's schedule rule forward (scheduler callback): persist the next
* due instant and the trigger instant. No-op for tasks without a rule (deleted
* mid-tick, for example).
* @param tasks - current ledger.
* @param id - the task to roll forward.
* @param nextRunAt - next due instant (may be undefined to clear).
* @param lastTriggeredAt - the trigger instant of this run.
* @param now - clock instant (ms epoch).
*/
function applyScheduleNextRun(tasks, id, nextRunAt, lastTriggeredAt, now) {
	return tasks.map((task) => task.id === id && task.archivedAt === void 0 && task.schedule !== void 0 ? withSchedule(task, {
		nextRunAt,
		lastTriggeredAt
	}, now) : task);
}
//#endregion
//#region src/core/use-cases/task-update.ts
/**
* Update-task use case: apply an editable-field patch (title/description/
* prompt/kind plus the execution targets workspaceId/mode/permission) with a
* fresh updatedAt. Pure ledger transition (no persistence or notify — the
* controller orchestrates those).
*
* An explicit `undefined` in the patch clears an execution-target field
* (the task falls back to the runtime default); content fields are trimmed
* and never cleared. An unknown permission string is ignored so stale UI
* can never persist a value the execution service rejects.
*
* Local fork: `description` is a free-form note and stays editable on an
* executed card (so a half-finished or mis-settled card can be annotated);
* `title`/`prompt` stay read-only after the first run because they are the
* record of what actually ran.
*/
/**
* The fields that edit the task's content (what the user reads and what the
* next execution sends). Unlike the execution targets they stay editable only
* while the task has never started executing — after the first run the
* recorded prompt is the record of what actually ran, so it becomes read-only.
*/
const TASK_CONTENT_FIELDS = [
	"title",
	"description",
	"prompt"
];
/**
* The subset of content fields that record what was actually planned and run.
* They freeze after the first execution; `description` is deliberately not
* here — it doubles as the human note field and stays editable.
*/
const TASK_IDENTITY_FIELDS = ["title", "prompt"];
/** Whether an update patch touches a frozen identity field. */
function hasIdentityPatch(patch) {
	return TASK_IDENTITY_FIELDS.some((field) => field in patch);
}
/**
* Whether a task's identity may still be edited: the task must be on-board
* (not archived) and must never have started executing. Fail-closed: a
* running, settled, or cancelled-before-launch task keeps title/prompt fixed.
*/
function canEditTaskIdentity(task) {
	return task.archivedAt === void 0 && task.status !== "running" && task.executions.length === 0;
}
/** Whether the free-form description note may be edited (any on-board card). */
function canEditDescription(task) {
	return task.archivedAt === void 0;
}
/** Keep an unknown permission string from entering the ledger. */
function normalizePermission(current, value) {
	if (value === void 0) return void 0;
	return isTaskPermission(value) ? value : current;
}
/**
* Apply an update across the ledger. Tasks that do not match the id are left
* untouched; the matched task receives the patch plus a fresh updatedAt.
* @param tasks - current ledger.
* @param id - the task to update.
* @param patch - editable-field changes.
* @param now - clock instant (ms epoch).
*/
function applyUpdateTask(tasks, id, patch, now) {
	return tasks.map((task) => {
		if (task.id !== id) return task;
		const workspaceId = "workspaceId" in patch ? normalizeTargetId(patch.workspaceId) : void 0;
		const mode = "mode" in patch ? normalizeTargetId(patch.mode) : void 0;
		const permission = "permission" in patch ? normalizePermission(task.permission, patch.permission) : void 0;
		const next = {
			...task,
			...patch,
			updatedAt: now
		};
		for (const field of TASK_CONTENT_FIELDS) {
			if (!(field in patch)) continue;
			const value = patch[field];
			next[field] = value === void 0 ? task[field] : value.trim();
		}
		if (workspaceId !== void 0 || "workspaceId" in patch) next.workspaceId = workspaceId;
		if (mode !== void 0 || "mode" in patch) next.mode = mode;
		if (permission !== void 0 || "permission" in patch) next.permission = permission;
		if ("kind" in patch) next.kind = isTaskKind(patch.kind) ? patch.kind : task.kind;
		if ("line" in patch) next.line = normalizeTargetId(patch.line);
		if ("seq" in patch) next.seq = normalizeTargetId(patch.seq);
		return next;
	});
}
//#endregion
//#region src/protocol.ts
const TASK_BOARD_API_PREFIX = "/api/task-board";
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function exactKeys(value, allowed) {
	return Object.keys(value).every((key) => allowed.includes(key));
}
function optionalString(value) {
	return value === void 0 || typeof value === "string";
}
const FORBIDDEN_IMPORT_FIELDS = /* @__PURE__ */ new Set([
	"args",
	"command",
	"executable",
	"powershell",
	"shell"
]);
function hasForbiddenImportField(value) {
	if (Array.isArray(value)) return value.some(hasForbiddenImportField);
	const row = record(value);
	if (row === void 0) return false;
	return Object.entries(row).some(([key, nested]) => FORBIDDEN_IMPORT_FIELDS.has(key.toLowerCase()) || hasForbiddenImportField(nested));
}
function optionalFiniteNumber(value) {
	return value === void 0 || typeof value === "number" && Number.isFinite(value);
}
function validImportedKnownFields(value) {
	if (value.schedule !== void 0) {
		const schedule = record(value.schedule);
		if (schedule === void 0 || typeof schedule.enabled !== "boolean" || typeof schedule.cron !== "string") return false;
		if (!optionalFiniteNumber(schedule.nextRunAt) || !optionalFiniteNumber(schedule.lastTriggeredAt)) return false;
	}
	if (value.executions !== void 0) {
		if (!Array.isArray(value.executions)) return false;
		for (const item of value.executions) {
			const execution = record(item);
			if (execution === void 0 || typeof execution.id !== "string" || !optionalString(execution.sessionId)) return false;
			if (typeof execution.startedAt !== "number" || !Number.isFinite(execution.startedAt)) return false;
			if (!optionalFiniteNumber(execution.endedAt) || !optionalString(execution.error)) return false;
			if (execution.result !== void 0 && ![
				"succeeded",
				"failed",
				"cancelled",
				"interrupted"
			].includes(String(execution.result))) return false;
		}
	}
	return true;
}
function importedTask(value) {
	const input = record(value);
	if (input === void 0 || hasForbiddenImportField(input) || !validImportedKnownFields(input)) return void 0;
	const task = parseLedger(JSON.stringify([value]))[0];
	if (task === void 0) return void 0;
	return {
		id: task.id,
		title: task.title,
		description: task.description,
		prompt: task.prompt,
		status: task.status,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		executions: task.executions.map((execution) => ({
			id: execution.id,
			sessionId: execution.sessionId,
			startedAt: execution.startedAt,
			endedAt: execution.endedAt,
			result: execution.result,
			error: execution.error
		})),
		...task.schedule === void 0 ? {} : { schedule: {
			enabled: task.schedule.enabled,
			cron: task.schedule.cron,
			nextRunAt: task.schedule.nextRunAt,
			lastTriggeredAt: task.schedule.lastTriggeredAt
		} },
		...task.workspaceId === void 0 ? {} : { workspaceId: task.workspaceId },
		...task.mode === void 0 ? {} : { mode: task.mode },
		...task.permission === void 0 ? {} : { permission: task.permission },
		...task.line === void 0 ? {} : { line: task.line },
		...task.seq === void 0 ? {} : { seq: task.seq },
		...task.archivedAt === void 0 ? {} : { archivedAt: task.archivedAt }
	};
}
function createInput(value) {
	const input = record(value);
	if (input === void 0 || !exactKeys(input, [
		"title",
		"description",
		"prompt",
		"workspaceId",
		"mode",
		"permission",
		"kind",
		"schedule",
		"line",
		"seq"
	])) return false;
	if (typeof input.title !== "string" || typeof input.description !== "string" || typeof input.prompt !== "string") return false;
	if (!optionalString(input.workspaceId) || !optionalString(input.mode)) return false;
	if (!optionalString(input.line) || !optionalString(input.seq)) return false;
	if (input.permission !== void 0 && !isTaskPermission(input.permission)) return false;
	if (input.kind !== void 0 && !isTaskKind(input.kind)) return false;
	if (input.schedule !== void 0) {
		const schedule = record(input.schedule);
		if (schedule === void 0 || !exactKeys(schedule, ["enabled", "cron"])) return false;
		if (typeof schedule.enabled !== "boolean" || typeof schedule.cron !== "string") return false;
	}
	return true;
}
function updatePatch(value) {
	const patch = record(value);
	if (patch === void 0 || !exactKeys(patch, [
		"title",
		"description",
		"prompt",
		"workspaceId",
		"mode",
		"permission",
		"kind",
		"line",
		"seq"
	])) return false;
	for (const key of [
		"title",
		"description",
		"prompt",
		"workspaceId",
		"mode",
		"line",
		"seq"
	]) if (!optionalString(patch[key])) return false;
	if (patch.permission !== void 0 && !isTaskPermission(patch.permission)) return false;
	return patch.kind === void 0 || isTaskKind(patch.kind);
}
function schedulePatch(value) {
	const patch = record(value);
	return patch !== void 0 && exactKeys(patch, ["enabled", "cron"]) && (patch.enabled === void 0 || typeof patch.enabled === "boolean") && (patch.cron === void 0 || typeof patch.cron === "string");
}
function parseActionEnvelope(value) {
	const envelope = record(value);
	if (envelope === void 0 || !exactKeys(envelope, ["requestId", "action"])) return void 0;
	if (typeof envelope.requestId !== "string" || envelope.requestId.trim() === "" || envelope.requestId.length > 256) return void 0;
	const action = record(envelope.action);
	if (action === void 0 || typeof action.kind !== "string") return void 0;
	const taskId = typeof action.taskId === "string" && action.taskId !== "" ? action.taskId : void 0;
	switch (action.kind) {
		case "import":
			if (!exactKeys(action, [
				"kind",
				"sourceId",
				"tasks"
			])) return void 0;
			if (typeof action.sourceId !== "string" || action.sourceId === "" || !Array.isArray(action.tasks)) return void 0;
			{
				const tasks = action.tasks.map(importedTask);
				return tasks.every((task) => task !== void 0) ? {
					requestId: envelope.requestId,
					action: {
						kind: "import",
						sourceId: action.sourceId,
						tasks
					}
				} : void 0;
			}
		case "create":
			if (!exactKeys(action, [
				"kind",
				"id",
				"input"
			])) return void 0;
			return typeof action.id === "string" && action.id !== "" && createInput(action.input) ? {
				requestId: envelope.requestId,
				action
			} : void 0;
		case "update":
			if (!exactKeys(action, [
				"kind",
				"taskId",
				"patch"
			])) return void 0;
			return taskId !== void 0 && updatePatch(action.patch) ? {
				requestId: envelope.requestId,
				action
			} : void 0;
		case "set-schedule":
			if (!exactKeys(action, [
				"kind",
				"taskId",
				"patch"
			])) return void 0;
			return taskId !== void 0 && schedulePatch(action.patch) ? {
				requestId: envelope.requestId,
				action
			} : void 0;
		case "move":
			if (!exactKeys(action, [
				"kind",
				"taskId",
				"status"
			])) return void 0;
			return taskId !== void 0 && isTaskStatus(action.status) ? {
				requestId: envelope.requestId,
				action
			} : void 0;
		case "confirm":
			if (!exactKeys(action, ["kind", "taskId"])) return void 0;
			return taskId === void 0 ? void 0 : {
				requestId: envelope.requestId,
				action: {
					kind: "confirm",
					taskId
				}
			};
		case "reject":
			if (!exactKeys(action, [
				"kind",
				"taskId",
				"note"
			])) return void 0;
			if (action.note !== void 0 && (typeof action.note !== "string" || action.note.length > 4e3)) return void 0;
			return taskId === void 0 ? void 0 : {
				requestId: envelope.requestId,
				action: {
					kind: "reject",
					taskId,
					...action.note === void 0 ? {} : { note: action.note }
				}
			};
		case "delete":
		case "archive":
		case "restore":
		case "run":
		case "rerun":
			if (!exactKeys(action, ["kind", "taskId"])) return void 0;
			return taskId === void 0 ? void 0 : {
				requestId: envelope.requestId,
				action
			};
		default: return;
	}
}
//#endregion
//#region src/host-ledger.ts
const MAX_REQUEST_CACHE = 256;
/**
* Extra `scheduler` fields contributed by a load that VALIDATED.
*
* `scheduler.error` must describe the load that is happening now, and a load
* that validated has nothing to report: whatever `parsed.scheduler.error` says
* belongs to an earlier one. The persisted field used to be copied straight
* through, so a single historical misjudgement — a ledger that was rejected
* once and quarantined, e.g. during a cross-line upgrade — was replayed verbatim
* by `GET /api/task-board/state` for ever, even after a healthy ledger replaced
* it. A stale string is worse than no string: it hides the real state.
*
* Only a fresh quarantine may publish an error, and that message is produced by
* the catch branch of `load()` (this load, this file, this reason). Errors that
* are recomputed from current data — invalid cron rules — never pass through
* here: `repairSchedules()` and the `import` action write them after the load,
* in the same call stack as the constructor.
*
* @returns the fields to spread into the rebuilt scheduler: none, on a clean load.
*/
function schedulerFieldsFromValidatedLoad() {
	return {};
}
function timeZone() {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
}
function cloneTasks(tasks) {
	return JSON.parse(JSON.stringify(tasks));
}
function hasOpenExecution(task) {
	return task.executions.some((execution) => execution.endedAt === void 0);
}
/**
* Process states that are dead but still occupy the PID table: `Z` (zombie)
* and `X` (dead, being reaped). `process.kill(pid, 0)` reports such PIDs as
* alive, so a crash leftover whose child was never reaped would otherwise be
* mistaken for a live owner and block ledger startup forever.
*/
const DEAD_STATES = /* @__PURE__ */ new Set(["Z", "X"]);
/**
* Best-effort single-letter process state ('R','S','D','Z',...) or undefined
* when no probe is available on this platform. Linux reads /proc/<pid>/stat
* directly (no subprocess); other POSIX shells out to `ps -o stat=`; Windows
* has no zombie state, so it returns undefined and the kill(0) probe alone
* is authoritative there.
*/
function processState(pid) {
	if (process.platform === "linux") try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const end = stat.lastIndexOf(")");
		if (end === -1) return void 0;
		return stat.slice(end + 2).split(" ")[0] || void 0;
	} catch {
		return;
	}
	if (process.platform === "win32") return void 0;
	try {
		const probe = spawnSync("ps", [
			"-o",
			"stat=",
			"-p",
			String(pid)
		], { timeout: PROCESS_PROBE_TIMEOUT_MS });
		if (probe.status !== 0 || probe.stdout.length === 0) return void 0;
		const state = probe.stdout.toString("utf8").trim();
		return state.length > 0 ? state[0] : void 0;
	} catch {
		return;
	}
}
function processIsAlive(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	const state = processState(pid);
	if (state !== void 0 && DEAD_STATES.has(state)) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
const PROCESS_PROBE_TIMEOUT_MS = 3e3;
let ownStartTime;
let ownStartTimeResolved = false;
/**
* Exact process start time (Unix epoch ms) on Linux, read straight from
* /proc (field 22 = start ticks since boot, btime = boot epoch seconds).
* No subprocess and no rounding, so the recorded `startedAt` from a previous
* boot compares exactly against the live process identity.
*/
function linuxStartTimeMs(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const end = stat.lastIndexOf(")");
		if (end === -1) return void 0;
		const ticks = Number(stat.slice(end + 2).split(" ")[19]);
		if (!Number.isFinite(ticks)) return void 0;
		const bootMatch = /^btime\s+(\d+)/m.exec(readFileSync("/proc/stat", "utf8"));
		if (bootMatch === null) return void 0;
		const btime = Number(bootMatch[1]);
		if (!Number.isFinite(btime)) return void 0;
		return btime * 1e3 + ticks * 1e3 / 100;
	} catch {
		return;
	}
}
/**
* Best-effort start time (Unix epoch ms) of a live process. Used to prove
* whether the ledger lock really belongs to the PID recorded in it, so a
* crash leftover whose PID was reused by an unrelated process (issue #786)
* is detected as stale instead of blocking startup forever. Returns
* undefined when the platform probe is unavailable; callers fail closed.
*/
function processStartTimeMs(pid) {
	if (process.platform === "linux") return linuxStartTimeMs(pid);
	if (process.platform === "win32") {
		const probe = spawnSync("powershell", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[DateTimeOffset]::FromFileTime((Get-Process -Id " + String(pid) + " -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToFileTime()).ToUnixTimeMilliseconds()"
		], {
			timeout: PROCESS_PROBE_TIMEOUT_MS,
			windowsHide: true
		});
		if (probe.status !== 0 || probe.stdout.length === 0) return void 0;
		const started = Number(probe.stdout.toString("utf8").trim());
		return Number.isFinite(started) ? started : void 0;
	}
	const env = {
		...process.env,
		LC_ALL: "C"
	};
	const probe = spawnSync("ps", [
		"-o",
		"lstart=",
		"-p",
		String(pid)
	], {
		timeout: PROCESS_PROBE_TIMEOUT_MS,
		env
	});
	if (probe.status === 0 && probe.stdout.length > 0) {
		const started = Date.parse(probe.stdout.toString("utf8").trim());
		if (Number.isFinite(started)) return started;
	}
	const elapsed = spawnSync("ps", [
		"-o",
		"etimes=",
		"-p",
		String(pid)
	], {
		timeout: PROCESS_PROBE_TIMEOUT_MS,
		env
	});
	if (elapsed.status !== 0 || elapsed.stdout.length === 0) return void 0;
	const seconds = Number(elapsed.stdout.toString("utf8").trim());
	if (!Number.isFinite(seconds)) return void 0;
	return Date.now() - seconds * 1e3;
}
function ownProcessStartTimeMs() {
	if (!ownStartTimeResolved) {
		ownStartTimeResolved = true;
		ownStartTime = processStartTimeMs(process.pid);
	}
	return ownStartTime;
}
/**
* Bounded tolerance for legacy lock records. Locks written before the
* ms-precise probe recorded `startedAt` from `ps -o lstart=` at whole-second
* resolution; probing the SAME live process exactly (via /proc) then differs
* in the sub-second remainder. Treating that as PID reuse would steal a live
* owner's lock during a rolling upgrade and start a second ledger writer.
* Records written by the ms-precise probe carry `probe: 'exact'` and are
* compared strictly; anything else (older locks, second-granularity probes)
* falls back to this bounded tolerance.
*/
const LEGACY_START_TOLERANCE_MS = 2e3;
/** Whether the recorded start time proves the recorded PID is another process. */
function startTimeMismatch(recorded, actual, exact) {
	return exact ? recorded !== actual : Math.abs(recorded - actual) > LEGACY_START_TOLERANCE_MS;
}
function betterExecution(a, b) {
	if (a.endedAt === void 0 && b.endedAt !== void 0) return b;
	if (b.endedAt === void 0 && a.endedAt !== void 0) return a;
	return (b.endedAt ?? b.startedAt) >= (a.endedAt ?? a.startedAt) ? b : a;
}
function mergeTask(a, b) {
	const newer = b.updatedAt > a.updatedAt ? b : a;
	const byId = /* @__PURE__ */ new Map();
	for (const entry of [...a.executions, ...b.executions]) {
		const previous = byId.get(entry.id);
		byId.set(entry.id, previous === void 0 ? entry : betterExecution(previous, entry));
	}
	const executions = [...byId.values()].sort((x, y) => x.startedAt - y.startedAt);
	return {
		...newer,
		executions: retainRecentExecutions(executions)
	};
}
function parseHostTasks(values) {
	const rawById = /* @__PURE__ */ new Map();
	for (const value of values) {
		if (typeof value !== "object" || value === null) continue;
		const raw = value;
		if (typeof raw.id === "string") rawById.set(raw.id, raw);
	}
	return parseLedger(JSON.stringify(values)).map((task) => {
		const rawSchedule = rawById.get(task.id)?.schedule;
		if (typeof rawSchedule !== "object" || rawSchedule === null) return task;
		const schedule = rawSchedule;
		if (typeof schedule.cron !== "string" || isValidCron(schedule.cron)) return task;
		return {
			...task,
			schedule: {
				enabled: false,
				cron: schedule.cron,
				nextRunAt: void 0,
				lastTriggeredAt: typeof schedule.lastTriggeredAt === "number" && Number.isFinite(schedule.lastTriggeredAt) ? schedule.lastTriggeredAt : void 0
			}
		};
	});
}
var HostTaskLedger = class {
	now;
	document;
	listeners = /* @__PURE__ */ new Set();
	requestCache = /* @__PURE__ */ new Map();
	lockToken = crypto.randomUUID();
	lockFd;
	file;
	lockFile;
	/** Small sidecar for the 30 s scheduler heartbeat (lastTickAt only). */
	schedulerFile;
	constructor(dir = join(dshHome(), "task-board"), now = Date.now) {
		this.now = now;
		mkdirSync(dir, { recursive: true });
		this.file = join(dir, "ledger-v2.json");
		this.lockFile = join(dir, "ledger-v2.lock");
		this.schedulerFile = join(dir, "scheduler-v2.json");
		this.lockFd = this.acquireLock();
		try {
			this.document = this.load(dir);
			for (const request of this.document.recentRequests) this.requestCache.set(request.requestId, { fingerprint: request.fingerprint });
			this.repairSchedules(true);
			this.reconcileInterruptedStarts();
			this.commit(false);
		} catch (error) {
			this.dispose();
			throw error;
		}
	}
	/** Revision + scheduler without any task cloning; feeds the SSE event frame. */
	summary() {
		const { importedSources: _imports, ...scheduler } = this.document.scheduler;
		return {
			revision: this.document.revision,
			scheduler: { ...scheduler }
		};
	}
	state() {
		const { revision, scheduler } = this.summary();
		return {
			revision,
			tasks: cloneTasks(this.document.tasks),
			scheduler
		};
	}
	/**
	* Runtime-only projection for the 5 s Host poll. It copies just primitive
	* identifiers and timestamps, never the complete task/execution history or
	* an authoritative mutable object from the ledger.
	*/
	runtimeView() {
		let armedSchedules = 0;
		const openExecutions = [];
		for (const task of this.document.tasks) {
			if (task.archivedAt === void 0 && task.schedule?.enabled === true) armedSchedules += 1;
			for (const execution of task.executions) {
				if (execution.endedAt !== void 0) continue;
				openExecutions.push({
					taskId: task.id,
					executionId: execution.id,
					sessionId: execution.sessionId,
					startedAt: execution.startedAt
				});
			}
		}
		return {
			armedSchedules,
			openExecutions
		};
	}
	/** Count armed, non-archived schedules without cloning task histories. */
	armedScheduleCount() {
		let count = 0;
		for (const task of this.document.tasks) if (task.archivedAt === void 0 && task.schedule?.enabled === true) count += 1;
		return count;
	}
	/** Return value-only references for schedules due at the supplied Host time. */
	dueSchedules(now) {
		const due = [];
		for (const task of this.document.tasks) {
			if (task.archivedAt !== void 0) continue;
			if (isInteractiveTask(task)) continue;
			const schedule = task.schedule;
			if (schedule === void 0 || !schedule.enabled || schedule.nextRunAt === void 0 || schedule.nextRunAt > now) continue;
			due.push({
				taskId: task.id,
				cron: schedule.cron,
				nextRunAt: schedule.nextRunAt
			});
		}
		return due;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	dispose() {
		const fd = this.lockFd;
		if (fd === void 0) return;
		this.lockFd = void 0;
		closeSync(fd);
		try {
			if (JSON.parse(readFileSync(this.lockFile, "utf8")).token === this.lockToken) unlinkSync(this.lockFile);
		} catch {}
	}
	hasRequest(requestId) { return this.requestCache.has(requestId); }
	applyRequest(requestId, action) {
		const fingerprint = createHash("sha256").update(JSON.stringify(action)).digest("hex");
		const cached = this.requestCache.get(requestId);
		if (cached !== void 0) {
			if (cached.fingerprint !== fingerprint) throw new Error("request id was reused with a different action");
			return { state: this.state() };
		}
		this.requestCache.set(requestId, { fingerprint });
		while (this.requestCache.size > MAX_REQUEST_CACHE) this.requestCache.delete(this.requestCache.keys().next().value);
		this.syncRecentRequests();
		try {
			return this.apply(action);
		} catch (error) {
			this.requestCache.delete(requestId);
			this.syncRecentRequests();
			throw error;
		}
	}
	openScheduled(taskId, nextRunAt, triggeredAt) {
		const task = this.document.tasks.find((item) => item.id === taskId);
		if (task === void 0 || task.archivedAt !== void 0) return void 0;
		if (isInteractiveTask(task)) return void 0;
		if (task.status === "running" || hasOpenExecution(task)) {
			this.document.tasks = [...applyScheduleNextRun(this.document.tasks, taskId, nextRunAt, task.schedule?.lastTriggeredAt, triggeredAt)];
			this.commit();
			return;
		}
		const opened = startExecution(task, triggeredAt, crypto.randomUUID());
		this.document.tasks = this.document.tasks.map((item) => item.id === taskId ? opened.task : item);
		this.document.tasks = [...applyScheduleNextRun(this.document.tasks, taskId, nextRunAt, triggeredAt, triggeredAt)];
		this.commit();
		return opened;
	}
	skipMissed(now) {
		let changed = false;
		this.document.tasks = this.document.tasks.map((task) => {
			const schedule = task.schedule;
			if (schedule === void 0 || !schedule.enabled || schedule.nextRunAt === void 0 || schedule.nextRunAt > now) return task;
			changed = true;
			return {
				...task,
				schedule: {
					...schedule,
					nextRunAt: nextRunAtMs(schedule.cron, now)
				},
				updatedAt: now
			};
		});
		if (changed) this.commit();
	}
	setScheduler(patch) {
		this.document.scheduler = {
			...this.document.scheduler,
			...patch
		};
		if (patch.lastTickAt !== void 0 && Object.keys(patch).every((key) => key === "lastTickAt")) {
			this.writeSchedulerSidecar();
			return;
		}
		this.commit(false);
	}
	attachSession(taskId, executionId, sessionId) {
		const now = this.now();
		this.document.tasks = this.document.tasks.map((task) => task.id !== taskId ? task : {
			...task,
			updatedAt: now,
			executions: task.executions.map((entry) => entry.id === executionId ? {
				...entry,
				sessionId
			} : entry)
		});
		this.commit();
	}
	settle(taskId, executionId, outcome, error) {
		this.document.tasks = this.document.tasks.map((task) => task.id === taskId ? settleExecution(task, executionId, outcome, this.now(), error) : task);
		this.commit();
	}
	apply(action) {
		const now = this.now();
		let run;
		switch (action.kind) {
			case "import": {
				const sources = new Set(this.document.scheduler.importedSources ?? []);
				if (sources.has(action.sourceId)) return { state: this.state() };
				const invalidScheduleIds = action.tasks.filter((task) => task.schedule !== void 0 && !isValidCron(task.schedule.cron)).map((task) => task.id);
				const incoming = parseHostTasks(action.tasks);
				const merged = new Map(this.document.tasks.map((task) => [task.id, task]));
				for (const task of incoming) merged.set(task.id, merged.has(task.id) ? mergeTask(merged.get(task.id), task) : task);
				this.document.tasks = [...merged.values()];
				this.document.scheduler.importedSources = [...sources, action.sourceId];
				this.document.scheduler.error = invalidScheduleIds.length === 0 ? void 0 : `invalid cron disabled for task(s): ${invalidScheduleIds.join(", ")}`;
				this.repairSchedules(true, false);
				this.reconcileInterruptedStarts(false);
				break;
			}
			case "create": {
				if (this.document.tasks.some((task) => task.id === action.id)) throw new Error("task id already exists");
				if (action.input.schedule?.enabled === true && (!isValidCron(action.input.schedule.cron) || nextRunAtMs(action.input.schedule.cron, now) === void 0)) throw new Error("invalid schedule");
				const result = applyCreateTask(this.document.tasks, action.input, now, action.id);
				if (result.task === void 0) throw new Error("invalid task");
				this.document.tasks = [...result.tasks];
				break;
			}
			case "update": {
				const task = this.document.tasks.find((task) => task.id === action.taskId);
				if (task === void 0) throw new Error("task not found");
				if (task.archivedAt !== void 0) throw new Error("archived task is read-only");
				if (hasIdentityPatch(action.patch) && !canEditTaskIdentity(task)) throw new Error("task has already been executed");
				if ("description" in action.patch && !canEditDescription(task)) throw new Error("archived task is read-only");
				if ("title" in action.patch && action.patch.title?.trim() === "") throw new Error("title is required");
				this.document.tasks = [...applyUpdateTask(this.document.tasks, action.taskId, action.patch, now)];
				break;
			}
			case "confirm": {
				const task = this.document.tasks.find((item) => item.id === action.taskId);
				if (task === void 0) throw new Error("task not found");
				if (task.archivedAt !== void 0) throw new Error("archived task is read-only");
				if (task.status !== "review") throw new Error("task is not awaiting acceptance");
				const next = confirmedStatus(task);
				this.document.tasks = this.document.tasks.map((item) => item.id === action.taskId ? withStatus(item, next, now) : item);
				break;
			}
			case "reject": {
				const task = this.document.tasks.find((item) => item.id === action.taskId);
				if (task === void 0) throw new Error("task not found");
				if (task.archivedAt !== void 0) throw new Error("archived task is read-only");
				if (task.status !== "review") throw new Error("task is not awaiting acceptance");
				const note = action.note?.trim();
				this.document.tasks = this.document.tasks.map((item) => {
					if (item.id !== action.taskId) return item;
					const moved = withStatus(item, "todo", now);
					return note === void 0 || note === "" ? moved : {
						...moved,
						description: moved.description === "" ? note : `${moved.description}\n\n[打回 ${new Date(now).toLocaleString("zh-CN")}] ${note}`
					};
				});
				break;
			}
			case "delete":
				{
					const task = this.document.tasks.find((task) => task.id === action.taskId);
					if (task === void 0) throw new Error("task not found");
					if (task.status === "running" || hasOpenExecution(task)) throw new Error("running task cannot be deleted");
				}
				this.document.tasks = [...applyDeleteTask(this.document.tasks, void 0, action.taskId).tasks];
				break;
			case "move": {
				const task = this.document.tasks.find((item) => item.id === action.taskId);
				if (task === void 0) throw new Error("task not found");
				if (task.archivedAt !== void 0) throw new Error("archived task is read-only");
				if (task.status === "running" || hasOpenExecution(task)) throw new Error("running task cannot be moved");
				if (!canMoveManually(task.status, action.status)) throw new Error("invalid manual status");
				this.document.tasks = this.document.tasks.map((item) => item.id === action.taskId ? withStatus(item, action.status, now) : item);
				break;
			}
			case "archive": {
				const result = applyArchiveTask(this.document.tasks, action.taskId, now);
				if (!result.archived) throw new Error("task cannot be archived");
				this.document.tasks = [...result.tasks];
				break;
			}
			case "restore": {
				const result = applyRestoreTask(this.document.tasks, action.taskId, now);
				if (!result.archived) throw new Error("task is not archived");
				this.document.tasks = [...result.tasks];
				break;
			}
			case "set-schedule": {
				const task = this.document.tasks.find((task) => task.id === action.taskId);
				if (task?.archivedAt !== void 0) throw new Error("archived task is read-only");
				if (task !== void 0 && isInteractiveTask(task) && action.patch.enabled !== false) throw new Error("interactive task cannot be scheduled");
				const result = applySetSchedule(this.document.tasks, action.taskId, action.patch, now);
				if (!result.applied) throw new Error("invalid schedule");
				this.document.tasks = [...result.tasks];
				break;
			}
			case "rerun":
			case "run": {
				const task = this.document.tasks.find((item) => item.id === action.taskId);
				if (task?.archivedAt !== void 0) throw new Error("archived task is read-only");
				if (task === void 0 || task.status === "running" || hasOpenExecution(task)) throw new Error("task is already running or missing");
				run = startExecution(action.kind === "rerun" ? withStatus(task, "todo", now) : task, now, crypto.randomUUID());
				this.document.tasks = this.document.tasks.map((item) => item.id === task.id ? run.task : item);
				break;
			}
		}
		this.commit();
		return {
			state: this.state(),
			...run === void 0 ? {} : { run }
		};
	}
	repairSchedules(skipPast, persist = true) {
		const now = this.now();
		let changed = false;
		this.document.tasks = this.document.tasks.map((task) => {
			const schedule = task.schedule;
			if (schedule === void 0 || !schedule.enabled) return task;
			if (!skipPast && schedule.nextRunAt !== void 0) return task;
			const next = nextRunAtMs(schedule.cron, now);
			if (next === void 0) {
				changed = true;
				this.document.scheduler.error = `invalid cron disabled for task: ${task.id}`;
				return {
					...task,
					schedule: {
						...schedule,
						enabled: false,
						nextRunAt: void 0
					},
					updatedAt: now
				};
			}
			if (schedule.nextRunAt === next) return task;
			changed = true;
			return {
				...task,
				schedule: {
					...schedule,
					nextRunAt: next
				},
				updatedAt: now
			};
		});
		if (changed && persist) this.commit();
	}
	/**
	* Startup half of the restart-recovery path (card [Q3]): an execution that
	* never got as far as recording its session was certainly cut off by the
	* restart, so it settles `interrupted` (never `succeeded`) and the card goes
	* back to `todo` with the reason on the execution.
	*
	* Executions that DO carry a session id are handled by the Host poll
	* (`HostTaskBoardService.reconcileExecutions`), which is asynchronous: the
	* session may still be alive in the new instance, so nothing may be settled
	* before its liveness is read.
	*/
	reconcileInterruptedStarts(persist = true) {
		const now = this.now();
		let changed = false;
		this.document.tasks = this.document.tasks.map((task) => {
			if (task.status !== "running") return task;
			const execution = task.executions.at(-1);
			if (execution === void 0 || execution.endedAt !== void 0 || execution.sessionId !== void 0) return task;
			changed = true;
			return settleExecution(task, execution.id, "interrupted", now, "execution interrupted: host restarted before the execution session was recorded");
		});
		if (changed && persist) this.commit();
	}
	load(dir) {
		const existed = existsSync(this.file);
		try {
			const parsed = JSON.parse(readFileSync(this.file, "utf8"));
			if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.tasks)) throw new Error("unsupported ledger schema");
			const tasks = parseHostTasks(parsed.tasks).map((task) => ({
				...task,
				executions: retainRecentExecutions(task.executions)
			}));
			const invalidScheduleIds = parsed.tasks.flatMap((value) => {
				if (typeof value !== "object" || value === null) return [];
				const row = value;
				if (typeof row.schedule !== "object" || row.schedule === null) return [];
				const cron = row.schedule.cron;
				return typeof cron !== "string" || !isValidCron(cron) ? [typeof row.id === "string" ? row.id : "unknown"] : [];
			});
			const documentLastTickAt = typeof parsed.scheduler?.lastTickAt === "number" ? parsed.scheduler.lastTickAt : void 0;
			const sidecarLastTickAt = this.readSchedulerSidecar();
			const lastTickAt = sidecarLastTickAt === void 0 || documentLastTickAt !== void 0 && documentLastTickAt >= sidecarLastTickAt ? documentLastTickAt : sidecarLastTickAt;
			return {
				schemaVersion: 2,
				revision: Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
				tasks,
				scheduler: {
					timeZone: timeZone(),
					ledgerId: typeof parsed.scheduler?.ledgerId === "string" && parsed.scheduler.ledgerId !== "" ? parsed.scheduler.ledgerId : crypto.randomUUID(),
					...lastTickAt === void 0 ? {} : { lastTickAt },
					...schedulerFieldsFromValidatedLoad(),
					...invalidScheduleIds.length > 0 ? { error: `invalid cron disabled for task(s): ${invalidScheduleIds.join(", ")}` } : {},
					...Array.isArray(parsed.scheduler?.importedSources) ? { importedSources: parsed.scheduler.importedSources.filter((x) => typeof x === "string") } : {}
				},
				recentRequests: Array.isArray(parsed.recentRequests) ? parsed.recentRequests.flatMap((entry) => {
					if (typeof entry !== "object" || entry === null) return [];
					const request = entry;
					return typeof request.requestId === "string" && request.requestId !== "" && typeof request.fingerprint === "string" ? [{
						requestId: request.requestId,
						fingerprint: request.fingerprint
					}] : [];
				}).slice(-256) : []
			};
		} catch (error) {
			if (existed) renameSync(this.file, `${this.file}.corrupt-${this.now()}-${process.pid}-${crypto.randomUUID()}`);
			mkdirSync(dir, { recursive: true });
			return {
				schemaVersion: 2,
				revision: 0,
				tasks: [],
				scheduler: {
					timeZone: timeZone(),
					ledgerId: crypto.randomUUID(),
					...existed ? { error: `corrupt ledger was quarantined: ${error instanceof Error ? error.message : String(error)}` } : {}
				},
				recentRequests: []
			};
		}
	}
	syncRecentRequests() {
		this.document.recentRequests = [...this.requestCache].map(([requestId, request]) => ({
			requestId,
			fingerprint: request.fingerprint
		}));
	}
	readSchedulerSidecar() {
		try {
			const parsed = JSON.parse(readFileSync(this.schedulerFile, "utf8"));
			return typeof parsed.lastTickAt === "number" && Number.isFinite(parsed.lastTickAt) ? parsed.lastTickAt : void 0;
		} catch {
			return;
		}
	}
	/** Atomic write of the scheduler heartbeat sidecar (0600, tmp + rename + fsync). */
	writeSchedulerSidecar() {
		const payload = JSON.stringify({ lastTickAt: this.document.scheduler.lastTickAt });
		mkdirSync(dirname(this.schedulerFile), { recursive: true });
		const tmp = `${this.schedulerFile}.tmp-${process.pid}`;
		let fd;
		try {
			fd = openSync(tmp, "w", 384);
			writeFileSync(fd, payload, { encoding: "utf8" });
			fsyncSync(fd);
			closeSync(fd);
			fd = void 0;
			try {
				chmodSync(tmp, 384);
			} catch {}
			renameSync(tmp, this.schedulerFile);
			try {
				const dirFd = openSync(dirname(this.schedulerFile), "r");
				try {
					fsyncSync(dirFd);
				} finally {
					closeSync(dirFd);
				}
			} catch {}
		} catch (error) {
			if (fd !== void 0) closeSync(fd);
			try {
				unlinkSync(tmp);
			} catch {}
			throw error;
		}
		this.notify();
	}
	commit(bumpRevision = true) {
		if (bumpRevision) this.document.revision += 1;
		mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.tmp-${process.pid}`;
		let fd;
		try {
			fd = openSync(tmp, "w", 384);
			writeFileSync(fd, JSON.stringify(this.document, null, 2), { encoding: "utf8" });
			fsyncSync(fd);
			closeSync(fd);
			fd = void 0;
			try {
				chmodSync(tmp, 384);
			} catch {}
			renameSync(tmp, this.file);
			try {
				const dirFd = openSync(dirname(this.file), "r");
				try {
					fsyncSync(dirFd);
				} finally {
					closeSync(dirFd);
				}
			} catch {}
		} catch (error) {
			if (fd !== void 0) closeSync(fd);
			try {
				unlinkSync(tmp);
			} catch {}
			throw error;
		}
		this.notify();
	}
	notify() {
		for (const listener of [...this.listeners]) listener();
	}
	acquireLock() {
		for (let attempt = 0; attempt < 2; attempt += 1) try {
			const fd = openSync(this.lockFile, "wx", 384);
			const startedAt = ownProcessStartTimeMs();
			const probe = process.platform === "linux" || process.platform === "win32" ? "exact" : "legacy";
			writeFileSync(fd, JSON.stringify({
				pid: process.pid,
				token: this.lockToken,
				startedAt,
				probe
			}), { encoding: "utf8" });
			fsyncSync(fd);
			try {
				chmodSync(this.lockFile, 384);
			} catch {}
			return fd;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			let pid;
			let ownerStartedAt;
			let ownerExact = false;
			try {
				const owner = JSON.parse(readFileSync(this.lockFile, "utf8"));
				if (typeof owner.pid === "number") pid = owner.pid;
				if (typeof owner.startedAt === "number") ownerStartedAt = owner.startedAt;
				ownerExact = owner.probe === "exact";
			} catch {
				throw new Error(`task-board ledger lock is unreadable: ${this.lockFile}; if this is a leftover from an unclean shutdown and no other DSH host is running, remove it manually and retry`);
			}
			if (pid !== void 0 && processIsAlive(pid)) {
				const actualStartedAt = pid === process.pid ? ownProcessStartTimeMs() : processStartTimeMs(pid);
				if (!(actualStartedAt !== void 0 && (ownerStartedAt !== void 0 ? startTimeMismatch(ownerStartedAt, actualStartedAt, ownerExact) : (() => {
					try {
						return statSync(this.lockFile).mtimeMs < actualStartedAt;
					} catch {
						return true;
					}
				})()))) {
					const hint = ownerStartedAt !== void 0 && actualStartedAt !== void 0 && !startTimeMismatch(ownerStartedAt, actualStartedAt, ownerExact) ? "" : `; if this PID was reused after a crash and no other DSH host is running, remove ${this.lockFile} manually and retry`;
					throw new Error(`task-board ledger is already owned by process ${pid}${hint}`);
				}
			}
			try {
				unlinkSync(this.lockFile);
			} catch (unlinkError) {
				if (unlinkError.code !== "ENOENT") throw unlinkError;
			}
		}
		throw new Error(`task-board ledger lock could not be acquired: ${this.lockFile}`);
	}
};
//#endregion
//#region src/host-runner.ts
function request(payload) {
	return {
		rpcId: `task-board-${crypto.randomUUID()}`,
		payload
	};
}
function failure(error) {
	return /* @__PURE__ */ new Error(`${error.code}: ${error.message}`);
}
/**
* Narrow an arbitrary service object to {@link NewLineSessionApi}.
*
* All three execution calls are required: a service that lacks any of them is
* not usable for `run`/`rerun`, and pretending otherwise would surface as a
* confusing runtime `TypeError` inside the ledger settle path instead of a
* clean "this line cannot execute" verdict.
*/
function asNewLineSessionApi(service) {
	if (typeof service !== "object" || service === null) return null;
	const candidate = service;
	if (typeof candidate.create !== "function") return null;
	if (typeof candidate.rename !== "function") return null;
	if (typeof candidate.prompt !== "function") return null;
	return candidate;
}
/** Read the `sessionId` out of a new-line `create` result; `undefined` when absent. */
function readCreatedSessionId(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const id = value.sessionId;
	return typeof id === "string" && id !== "" ? id : void 0;
}
/**
* Read session rows out of a new-line `list` result.
*
* `null` means "this answer is not a session list" (unexpected shape, or the
* call rejected) — callers must treat that as "unknown", never as "no sessions
* are running", because settling an execution on a guess is exactly the
* false-settlement failure this gate exists to prevent.
*/
function readSessionRows(value) {
	if (typeof value !== "object" || value === null) return null;
	const items = value.items;
	if (!Array.isArray(items)) return null;
	const rows = [];
	for (const item of items) {
		if (typeof item !== "object" || item === null) continue;
		const row = item;
		if (typeof row.sessionId !== "string" || row.sessionId === "") continue;
		const stamp = normalizeEpochMs(row.updatedAt);
		rows.push({
			sessionId: row.sessionId,
			running: row.running === true,
			...stamp === void 0 ? {} : { updatedAt: stamp }
		});
	}
	return rows;
}
/**
* Read `inspect`'s event array.
*
* `null` = the answer is not a recognisable event list: `events` missing / not
* an array, or a **non-empty** array whose rows carry no string `type` (a shape
* this build cannot classify). Both mean "fall back to the next reader" —
* never "no events", which would settle a live execution `interrupted` off a
* shape we simply do not understand.
*
* An **empty** array is a valid answer and is kept: "the session has no
* events" is a real verdict the outcome classifier must see.
*/
function readInspectionEvents(value) {
	if (typeof value !== "object" || value === null) return null;
	const events = value.events;
	if (!Array.isArray(events)) return null;
	const entries = [];
	let typed = 0;
	for (const raw of events) {
		if (typeof raw !== "object" || raw === null) continue;
		const event = raw;
		if (typeof event.type === "string") typed += 1;
		entries.push({ event: {
			type: typeof event.type === "string" ? event.type : "",
			...typeof event.seq === "number" ? { seq: event.seq } : {},
			...typeof event.time === "number" ? { time: event.time } : {},
			data: event.data
		} });
	}
	if (events.length > 0 && typed === 0) return null;
	return entries;
}
/** How many message-aligned events one history page asks for. */
const HISTORY_PAGE_MESSAGES = 100;
/** Hard cap on the pages one history read walks. */
const HISTORY_MAX_PAGES = 100;
/**
* The pre-0.1.5 session-history RPC name, spelled in two pieces.
*
* 0.1.5 removed the endpoint (it answers 404 even with a valid session
* cookie), so the only places that still need its name are the legacy reader
* and this comment. Joining the two pieces keeps the fallback real code while
* the built artifact never spells the removed method name out in one piece.
*/
const LEGACY_HISTORY_METHOD = ["session", "history"].join(".");
/** Per-call timeout of one history page read. */
const HISTORY_PAGE_TIMEOUT_MS = 8e3;
/**
* `throughSeq` of the deliberate over-large cursor probe.
*
* `sessionController.page` validates `throughSeq` against the session's real
* cursor and rejects a larger one with `gateway/bad-request … past cursor N`.
* There is no "give me the tail" value: `-1` passes the validator but paginates
* to an empty slice, so a reader that wants the newest events has to learn the
* cursor first — exactly what this probe does.
*/
const SESSION_CURSOR_PROBE = Number.MAX_SAFE_INTEGER;
/**
* Read the cursor out of a rejected over-large `page` request.
*
* `undefined` = the rejection does not carry one (unknown session, transport
* failure, a message shape this build has never seen) ⇒ the caller keeps its
* previous reader instead of guessing a cursor.
*/
function cursorFromRejection(error) {
	const message = error instanceof Error ? error.message : String(error);
	const match = /past cursor (-?\d+)/u.exec(message);
	if (match === null) return void 0;
	const cursor = Number(match[1]);
	return Number.isSafeInteger(cursor) ? cursor : void 0;
}
/**
* Read a `sessionController.page` answer.
*
* The measured line answers `{ records, hasMore }` where every record is the
* `{ type: 'event', event }` envelope the pre-0.1.5 HTTP envelope carried, so
* the rows unwrap into the one history shape both readers and the outcome
* classifier speak.
*
* `null` = an answer this build cannot classify (no `records` array, or a
* non-empty array whose rows carry no event objects) ⇒ the caller falls back
* rather than reading it as "no history".
*/
function readPageRecords(value, strict = false) {
	if (typeof value !== "object" || value === null) return null;
	const page = value;
	if (!Array.isArray(page.records) || (strict && typeof page.hasMore !== "boolean")) return null;
	const rows = [];
	for (const record of page.records) {
		if (strict) {
			if (typeof record !== "object" || record === null || record.type !== "event") return null;
			const event = record.event;
			if (typeof event !== "object" || event === null || typeof event.type !== "string" || event.type === "" || !Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isFinite(event.time) || event.time < 0 || !Object.hasOwn(event, "data")) return null;
		}
		rows.push(typeof record === "object" && record !== null ? record.event : void 0);
	}
	const events = readInspectionEvents({ events: rows });
	if (events === null || (strict && page.hasMore === true && events.length === 0)) return null;
	return {
		events,
		hasMore: page.hasMore === true
	};
}
/** The request id the new-line prompt surface uses for idempotent admission. */
function newLineRequestId() {
	return `task-board-${crypto.randomUUID()}`;
}
/** A post-create launch failure that still identifies the session to the ledger. */
var SessionLaunchError = class extends Error {
	sessionId;
	constructor(sessionId, cause) {
		super(`execution session ${sessionId} failed during launch: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		this.sessionId = sessionId;
		this.name = "SessionLaunchError";
	}
};
/**
* The `apiProxy` service is not provided by this host line.
*
* 2026-09-14 (card `升级 B2` step ④): `@deepseek-ai/dsh-host-apiproxy` is gone
* in the 0.1.5 closure — it was split into per-domain services. The plugin no
* longer declares it statically (that made the entry permanently `pending`),
* so an execution attempt here must fail **explicitly**: a silent no-op would
* look like a card stuck in 进行中 with no explanation.
*/
var ApiProxyUnavailableError = class extends Error {
	constructor() {
		super("apiProxy service is unavailable on this host line: board session execution (run/rerun) is disabled; the board UI, ledger and cron scheduling remain functional");
		this.name = "ApiProxyUnavailableError";
	}
};
/**
* Whether an execution that still resolves to `pending` must be settled
* `interrupted` instead of being left running.
*
* All of the following must hold:
* - the liveness gate said the session is **not running** (`sessionEnded`);
* - the execution itself is older than the threshold;
* - the session has been silent (Host stamp, else the execution's own start)
*   for at least the threshold.
*
* Anything else keeps the old conservative behaviour: the card stays running.
* This is deliberately blind to *why* inspect failed — it is a liveness-based
* safety net, not a second outcome classifier.
*/
function isStalePendingSettlement(input) {
	if (input.sessionEnded !== true) return false;
	const thresholdMs = input.thresholdMs ?? 6e5;
	if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return false;
	if (!Number.isFinite(input.startedAt) || input.startedAt <= 0) return false;
	if (input.now - input.startedAt < thresholdMs) return false;
	const last = Math.max(input.startedAt, Number.isFinite(input.lastActivityAt ?? NaN) ? input.lastActivityAt : 0);
	return input.now - last >= thresholdMs;
}
/** Normalize an epoch stamp that may arrive in seconds (Host projections) or ms. */
function normalizeEpochMs(value) {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n) || n <= 0) return void 0;
	return n < 0xe8d4a51000 ? n * 1e3 : n;
}
/**
* Decide whether an execution's session is still alive.
*
* Single implementation for both settlement paths (card [Q3]): the normal
* reconcile pass and the post-restart recovery pass both ask this question
* before they are allowed to write an outcome. Rules:
*
* - running === true → **alive**: never settle. A DSH restart can hand the
*   turn over to the new instance (the 11:53 false settlements' sessions kept
*   running for minutes after the ledger said `succeeded`).
* - listed but idle → ended normally; the caller may settle from its history.
* - not listed at all → gone (archived / cleaned / never came back).
* - list unreadable → `determined: false`; the caller keeps the card running
*   instead of guessing.
*/
function isExecutionAlive(sessionId, index) {
	if (sessionId === void 0 || sessionId === "") return {
		determined: true,
		alive: false,
		reason: "no-session-id"
	};
	if (!index.known) return {
		determined: false,
		alive: false,
		reason: "liveness-unknown"
	};
	if (index.running.has(sessionId)) return {
		determined: true,
		alive: true,
		reason: "session-running"
	};
	if (index.listed.has(sessionId)) return {
		determined: true,
		alive: false,
		reason: "session-idle"
	};
	return {
		determined: true,
		alive: false,
		reason: "session-missing"
	};
}
/**
* Classify one `turn/end` event by its `reason.kind`.
*
* Measured on this machine's own session logs (2026-09-11): the reason kinds
* in the wild are `completed` (145), `interrupted` (23), `aborted` (16) and
* `error` (1). The pre-[Q3] fork only recognised `error`, so every
* `interrupted` / `aborted` turn — exactly what a restart produces — was
* reported as a success. Only `completed` succeeds; `error` fails; everything
* else (including a future reason kind this build has never seen) is
* `interrupted`, because "unknown outcome" must never read as "done".
*/
function classifyTurnEnd(data) {
	const kind = typeof data === "object" && data !== null ? data.reason?.kind : void 0;
	if (kind === "completed") return {
		outcome: "succeeded",
		reason: "completed"
	};
	if (kind === "error") return {
		outcome: "failed",
		reason: "error"
	};
	return {
		outcome: "interrupted",
		reason: typeof kind === "string" && kind !== "" ? kind : "unknown"
	};
}
var HostExecutionRunner = class {
	resolveApi;
	commands;
	resolveNewSession;
	/** Set on the first call that finds no usable session service, so it warns once. */
	apiWarned = false;
	constructor(resolveApi, commands, resolveNewSession = () => null) {
		this.resolveApi = resolveApi;
		this.commands = commands;
		this.resolveNewSession = resolveNewSession;
	}
	/**
	* Resolve the 0.1.5-line session service for this call (late binding).
	*
	* `null` means "this host line does not offer a usable new session surface":
	* either the service is missing (0.1.1 line) or its shape is incomplete. The
	* caller then falls back to the legacy proxy, and raises
	* {@link ApiProxyUnavailableError} when neither line exists.
	*/
	newSession() {
		try {
			return asNewLineSessionApi(this.resolveNewSession());
		} catch {
			return null;
		}
	}
	/** Raise the shared "no session service on this host line" failure (warns once). */
	unavailable() {
		if (!this.apiWarned) {
			this.apiWarned = true;
			console.warn(`[dsh-task-board] ${new ApiProxyUnavailableError().message}`);
		}
		throw new ApiProxyUnavailableError();
	}
	/**
	* Resolve the legacy `apiProxy` service for this call.
	*
	* Late binding + fail loud: `apiProxy` exists on the 0.1.1 line (behaviour
	* unchanged), and does not exist on 0.1.5+ where it was split into
	* per-domain services. A missing service must never surface as a silent
	* `undefined` — an execution attempt that cannot run says so explicitly.
	*/
	api() {
		const api = this.resolveApi();
		if (api === null) this.unavailable();
		return api;
	}
	/** HTTP base of the running Host (test instances set DSH_WEB_URL). */
	base() {
		return process.env.DSH_WEB_URL || "http://127.0.0.1:3080";
	}
	/**
	* Start one execution session, on whichever host line this process runs.
	*
	* The 0.1.5 line is tried first (`sessionController`), the 0.1.1 proxy
	* second, and "neither" fails loud. The order matters on a line that mounts
	* both: the new surface is the one the Host itself uses.
	*/
	async launch(task) {
		const newLine = this.newSession();
		if (newLine !== null) return this.launchNewLine(newLine, task);
		return this.launchLegacy(this.api(), task);
	}
	/**
	* 0.1.5 line: `sessionController.create` → `rename` → [permission] → `prompt`.
	*
	* Unlike the legacy path there is **no `workspace.list` / `agentPresets.list`
	* pre-check**: the new service validates both itself (`workspace/<id> not
	* found` on `create`, the preset through `agents.ensureSession`) and the
	* line exposes no equivalent "list workspaces" call on the session domain.
	* Failing inside `create` reaches the same ledger outcome (execution settled
	* `failed` with the message) — the board never sees a silent no-op.
	*/
	async launchNewLine(api, task) {
		const sessionId = readCreatedSessionId(await api.create({
			...task.workspaceId === void 0 ? {} : { workspaceId: task.workspaceId },
			...task.mode === void 0 ? {} : { agentPreset: task.mode }
		}));
		if (sessionId === void 0) throw new Error("session create returned no session id (0.1.5 sessionController)");
		try {
			await api.rename({
				sessionId,
				title: task.title
			});
			if (task.permission !== void 0) {
				if (this.commands === void 0) throw new Error("permission command dispatcher is unavailable");
				const command = await this.commands.execute(sessionId, `/permission ${task.permission}`, AbortSignal.timeout(3e4));
				if (command === void 0) throw new Error("permission command was not acknowledged");
				if (command.kind !== "success") throw new Error(command.text ?? "permission command failed");
			}
			await api.prompt({
				requestId: newLineRequestId(),
				sessionId,
				mode: "queue",
				content: [{
					type: "text",
					text: executionPrompt(task)
				}]
			}, AbortSignal.timeout(3e4));
		} catch (error) {
			throw new SessionLaunchError(sessionId, error);
		}
		return sessionId;
	}
	/** 0.1.1 line: the legacy `apiProxy` RPC sequence, unchanged. */
	async launchLegacy(api, task) {
		if (task.workspaceId !== void 0) {
			const workspaces = await api.workspace.list(request({}));
			if (!workspaces.result.ok) throw failure(workspaces.result.error);
			if (!workspaces.result.value.items.some((item) => item.workspaceId === task.workspaceId)) throw new Error(`workspace not found: ${task.workspaceId}`);
		}
		if (task.mode !== void 0) {
			const presets = await api.agentPresets.list(request({}));
			if (!presets.result.ok) throw failure(presets.result.error);
			const preset = presets.result.value.presets.find((item) => item.id === task.mode);
			if (preset === void 0) throw new Error(`agent preset not found: ${task.mode}`);
			if (preset.broken !== void 0) throw new Error(`agent preset is unavailable: ${preset.broken}`);
		}
		const created = await api.sessions.create(request({
			...task.workspaceId === void 0 ? {} : { workspaceId: task.workspaceId },
			...task.mode === void 0 ? {} : { agentPreset: task.mode }
		}));
		if (!created.result.ok) throw failure(created.result.error);
		const sessionId = created.result.value.sessionId;
		try {
			const renamed = await api.sessions.rename(request({
				sessionId,
				title: task.title
			}));
			if (!renamed.result.ok) throw failure(renamed.result.error);
			if (task.permission !== void 0) {
				if (this.commands === void 0) throw new Error("permission command dispatcher is unavailable");
				const command = await this.commands.execute(sessionId, `/permission ${task.permission}`, AbortSignal.timeout(3e4));
				if (command === void 0) throw new Error("permission command was not acknowledged");
				if (command.kind !== "success") throw new Error(command.text ?? "permission command failed");
			}
			const prompt = await api.sessions.prompt(request({
				sessionId,
				mode: "queue",
				content: [{
					type: "text",
					text: executionPrompt(task)
				}]
			}));
			if (!prompt.result.ok) throw failure(prompt.result.error);
		} catch (error) {
			throw new SessionLaunchError(sessionId, error);
		}
		return sessionId;
	}
	async listRunning() {
		try {
			const newLine = this.newSession();
			if (newLine !== null && newLine.list !== void 0) {
				const rows = readSessionRows(await newLine.list({}, AbortSignal.timeout(8e3)));
				if (rows === null) return { known: false };
				return {
					known: true,
					count: rows.filter((row) => row.running).length,
					items: rows
				};
			}
			const api = this.resolveApi();
			if (api === null) return { known: false };
			const response = await api.sessions.list(request({}));
			return response.result.ok ? {
				known: true,
				count: response.result.value.items.filter((item) => item.running).length,
				items: response.result.value.items
			} : { known: false };
		} catch {
			return { known: false };
		}
	}
	/**
	* Read the live session index through the HTTP envelope.
	*
	* The liveness gate needs every session, not just the controller tree:
	* `apiProxy.sessions.list` only returns controller-tree sessions, so the
	* unattended execution sessions created through the proxy are missing from
	* it (the same reason {@link inspect} reads session history over HTTP).
	* Failure is reported as `known: false` so callers keep cards running
	* rather than settling on a guess.
	*/
	async listSessionLiveness() {
		const empty = {
			known: false,
			running: /* @__PURE__ */ new Set(),
			listed: /* @__PURE__ */ new Set()
		};
		const viaNewLine = await this.livenessFromNewLine();
		if (viaNewLine !== null) return viaNewLine;
		try {
			const json = await (await fetch(`${this.base()}/api/session.list`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					method: "session.list",
					rpcId: `taskboard-${Math.random().toString(36).slice(2)}`,
					payload: {}
				}),
				signal: AbortSignal.timeout(8e3)
			})).json();
			if (json?.result?.ok !== true) return empty;
			const running = /* @__PURE__ */ new Set();
			const listed = /* @__PURE__ */ new Set();
			const lastActivity = /* @__PURE__ */ new Map();
			for (const item of json.result.value?.items ?? []) {
				if (typeof item?.sessionId !== "string" || item.sessionId === "") continue;
				listed.add(item.sessionId);
				if (item.running === true) running.add(item.sessionId);
				const stamp = normalizeEpochMs(item.updatedAt);
				if (stamp !== void 0) lastActivity.set(item.sessionId, stamp);
			}
			return {
				known: true,
				running,
				listed,
				lastActivity
			};
		} catch {
			return empty;
		}
	}
	/**
	* Session index off the 0.1.5 service, or `null` when this line cannot
	* answer (service missing, `list` absent, call rejected, shape unknown) —
	* the caller then reads the HTTP envelope exactly as before.
	*/
	async livenessFromNewLine() {
		const newLine = this.newSession();
		if (newLine === null || newLine.list === void 0) return null;
		try {
			const rows = readSessionRows(await newLine.list({}, AbortSignal.timeout(8e3)));
			if (rows === null) return null;
			const running = /* @__PURE__ */ new Set();
			const listed = /* @__PURE__ */ new Set();
			const lastActivity = /* @__PURE__ */ new Map();
			for (const row of rows) {
				listed.add(row.sessionId);
				if (row.running) running.add(row.sessionId);
				if (row.updatedAt !== void 0) lastActivity.set(row.sessionId, row.updatedAt);
			}
			return {
				known: true,
				running,
				listed,
				lastActivity
			};
		} catch {
			return null;
		}
	}
	/**
	* Resolve one execution's outcome.
	*
	* Reader order: the 0.1.5 service's whole-log `inspect` first, its **paged**
	* reader second, and the pre-0.1.5 HTTP envelope last. The paged reader sits
	* in the middle because the HTTP endpoint was removed on the 0.1.5 line
	* (404 even with a valid session cookie), so without it the last-resort
	* reader would be a guaranteed failure on the very line that ships it.
	*
	* Card [Q3]: the caller must have already cleared the liveness gate
	* (`isExecutionAlive` → `alive === false`) and passes `sessionEnded: true`.
	* With that flag an execution that never produced a completing turn resolves
	* `interrupted` instead of hanging as `pending` forever, and a `turn/end`
	* that did not complete resolves `interrupted` instead of `succeeded`.
	*/
	async inspect(sessionId, startedAt = 0, options = {}) {
		const read = await this.inspectFromNewLine(sessionId) ?? await this.readPageFromNewLine(sessionId, startedAt) ?? await this.readHistoryOverHttp(sessionId, startedAt);
		return this.outcomeFromHistory(read, startedAt, options.sessionEnded === true);
	}
	/**
	* 从一次历史读的结果判定执行结论。
	*
	* 三条读法**共用同一套判据**（"首个 `turn/end` 判定" + 30s 启动宽限），
	* 抽出来是为了让它们不可能各自漂移。
	* 调用方必须已经清过判活闸门（`isExecutionAlive` → `alive === false`）并传 `sessionEnded: true`。
	*/
	outcomeFromHistory(read, startedAt, sessionEnded) {
		if (read === "transport-error") return { outcome: "pending" };
		const { events, reachedExecutionBoundary, readFailed } = read;
		const withinLaunchWindow = startedAt > 0 && Date.now() - startedAt < 3e4;
		if (readFailed || events.length === 0) {
			if (withinLaunchWindow) return { outcome: "pending" };
			return sessionEnded ? {
				outcome: "interrupted",
				error: "execution session ended with no readable history (interrupted before it ran — DSH restart or killed daemon)"
			} : { outcome: "pending" };
		}
		if (!reachedExecutionBoundary) return { outcome: "pending" };
		const turnEnd = events.filter((entry) => isTurnEnd(entry.event?.type) && (startedAt <= 0 || typeof entry.event.time === "number" && entry.event.time >= startedAt)).sort((a, b) => (a.event.seq ?? Number.MAX_SAFE_INTEGER) - (b.event.seq ?? Number.MAX_SAFE_INTEGER))[0];
		if (turnEnd === void 0) return sessionEnded && !withinLaunchWindow ? {
			outcome: "interrupted",
			error: "execution session ended without a completed turn (interrupted — DSH restart or killed daemon)"
		} : { outcome: "pending" };
		const verdict = classifyTurnEnd(turnEnd.event.data);
		if (verdict.outcome === "failed") return {
			outcome: "failed",
			error: "agent turn ended with an error"
		};
		if (verdict.outcome === "interrupted") return {
			outcome: "interrupted",
			error: `agent turn ended without completing (turn/end reason: ${verdict.reason})`
		};
		return { outcome: "succeeded" };
	}
	/**
	* Read one session's durable log off the 0.1.5 service.
	*
	* `null` = this line cannot answer (no `inspect` on the service, the call
	* rejected — e.g. the session is unknown — or the answer has a shape this
	* build does not classify) ⇒ the caller falls back to the next reader.
	*
	* `sessionController.inspect` returns the whole contiguous log from seq 0,
	* so the execution boundary is reached by definition (the HTTP reader pages
	* backwards and has to prove it reached the boundary — that proof is
	* unnecessary here).
	*/
	async inspectFromNewLine(sessionId) {
		const newLine = this.newSession();
		if (newLine === null || newLine.inspect === void 0) return null;
		try {
			const events = readInspectionEvents(await newLine.inspect(sessionId, AbortSignal.timeout(8e3)));
			if (events === null) return null;
			return {
				events,
				reachedExecutionBoundary: true,
				readFailed: false
			};
		} catch {
			return null;
		}
	}
	/**
	* Learn one session's log cursor for the paged reader.
	*
	* `page` needs a real cursor — `throughSeq` must be ≤ the session's own, and
	* `-1` (which the validator accepts) paginates to an empty slice, so there is
	* no "give me the tail" value. The cursor is therefore learned from the
	* rejection of a deliberately over-large probe (`gateway/bad-request … past
	* cursor N`).
	*
	* `null` = anything else came back (the probe was accepted, the message
	* carries no cursor, the cursor is negative) ⇒ "this line cannot answer",
	* never a guessed cursor.
	*/
	async pageCursor(newLine, sessionId) {
		const page = newLine.page;
		if (page === void 0) return null;
		try {
			await page.call(newLine, {
				address: {
					kind: "session",
					sessionId
				},
				throughSeq: SESSION_CURSOR_PROBE,
				maxMessages: 1
			}, AbortSignal.timeout(HISTORY_PAGE_TIMEOUT_MS));
			return null;
		} catch (error) {
			const cursor = cursorFromRejection(error);
			return cursor === void 0 || cursor < 0 ? null : cursor;
		}
	}
	/**
	* Read one session's durable log through the 0.1.5 line's **paged** reader.
	*
	* `null` = this line cannot answer (no `page` on the service, no cursor, a
	* rejected call, a shape this build does not classify) ⇒ the caller falls
	* back exactly as it did before this card.
	*
	* The pagination mirrors {@link readHistoryOverHttp} step for step: the same
	* page size, the same "walk back until the page reports no more, or its
	* oldest stamp reaches `startedAt`" boundary proof, and the same per-entry
	* `push` — never a spread, because one page can carry >100k events and
	* spreading that many arguments throws `RangeError`.
	*/
	async readPageFromNewLine(sessionId, startedAt) {
		const newLine = this.newSession();
		const nativeEvents = newLine?.events;
		const page = newLine === null ? void 0 : nativeEvents ?? newLine.page;
		if (newLine === null || page === void 0) return null;
		let cursor;
		if (nativeEvents === void 0) {
			const legacyCursor = await this.pageCursor(newLine, sessionId);
			if (legacyCursor === null) return null;
			cursor = legacyCursor;
		}
		const events = [];
		let beforeSeq;
		let reachedExecutionBoundary = false;
		try {
			for (let round = 0; round < HISTORY_MAX_PAGES; round += 1) {
				const raw = await page.call(newLine, {
					address: {
						kind: "session",
						sessionId
					},
					...cursor === void 0 ? {} : { throughSeq: cursor },
					maxMessages: HISTORY_PAGE_MESSAGES,
					...beforeSeq === void 0 ? {} : { beforeSeq }
				}, AbortSignal.timeout(HISTORY_PAGE_TIMEOUT_MS));
				const read = readPageRecords(raw, nativeEvents !== void 0);
				if (read === null) return null;
				if (nativeEvents !== void 0) {
					const observed = raw.cursor;
					if (typeof observed !== "number" || !Number.isSafeInteger(observed) || observed < -1) return null;
					if (cursor !== void 0 && observed !== cursor) return null;
					let previous = -1;
					for (const entry of read.events) {
						const seq = entry.event?.seq;
						if (typeof seq !== "number" || seq > observed || (beforeSeq !== void 0 && seq >= beforeSeq) || seq <= previous) return null;
						previous = seq;
					}
					cursor = observed;
				}
				for (const entry of read.events) events.push(entry);
				const oldestTime = read.events.reduce((oldest, entry) => {
					const time = entry.event?.time;
					return typeof time !== "number" ? oldest : oldest === void 0 ? time : Math.min(oldest, time);
				}, void 0);
				if (read.hasMore !== true || oldestTime !== void 0 && oldestTime <= startedAt) {
					reachedExecutionBoundary = true;
					break;
				}
				const oldestSeq = read.events.reduce((oldest, entry) => {
					const seq = entry.event?.seq;
					return typeof seq !== "number" ? oldest : oldest === void 0 ? seq : Math.min(oldest, seq);
				}, void 0);
				if (oldestSeq === void 0 || oldestSeq === beforeSeq) break;
				beforeSeq = oldestSeq;
			}
		} catch {
			return null;
		}
		return {
			events,
			reachedExecutionBoundary,
			readFailed: false
		};
	}
	/**
	* Read one session's history through the pre-0.1.5 HTTP envelope.
	*
	* Kept as the last-resort reader: it is the 0.1.1 line's only reader, and on
	* the 0.1.5 line the endpoint answers 404, which surfaces as `readFailed`
	* and resolves to `pending` rather than to a guessed outcome.
	*/
	async readHistoryOverHttp(sessionId, startedAt) {
		const base = this.base();
		const events = [];
		let beforeSeq;
		let reachedExecutionBoundary = false;
		let readFailed = false;
		try {
			for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
				const json = await (await fetch(`${base}/api/${LEGACY_HISTORY_METHOD}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: "client-request",
						method: LEGACY_HISTORY_METHOD,
						rpcId: `taskboard-${Math.random().toString(36).slice(2)}`,
						payload: {
							sessionId,
							maxMessages: HISTORY_PAGE_MESSAGES,
							...beforeSeq === void 0 ? {} : { beforeSeq }
						}
					}),
					signal: AbortSignal.timeout(HISTORY_PAGE_TIMEOUT_MS)
				})).json();
				if (json?.result?.ok !== true) {
					readFailed = true;
					break;
				}
				const value = json.result.value ?? {};
				const pageEvents = value.events ?? [];
				for (const entry of pageEvents) events.push(entry);
				const oldestTime = pageEvents.reduce((oldest, entry) => {
					const time = entry.event?.time;
					return typeof time !== "number" ? oldest : oldest === void 0 ? time : Math.min(oldest, time);
				}, void 0);
				if (value.hasMore !== true || oldestTime !== void 0 && oldestTime <= startedAt) {
					reachedExecutionBoundary = true;
					break;
				}
				const oldestSeq = pageEvents.reduce((oldest, entry) => {
					const seq = entry.event?.seq;
					return typeof seq !== "number" ? oldest : oldest === void 0 ? seq : Math.min(oldest, seq);
				}, void 0);
				if (oldestSeq === void 0 || oldestSeq === beforeSeq) break;
				beforeSeq = oldestSeq;
			}
		} catch {
			return "transport-error";
		}
		return {
			events,
			reachedExecutionBoundary,
			readFailed
		};
	}
};
//#endregion
//#region src/power-inhibitor.ts
const RETRY_DELAYS = [
	1e3,
	2e3,
	5e3,
	1e4,
	3e4
];
const DARWIN_STABLE_MS = 3e4;
const WINDOWS_HELPER = String.raw`
$source = @'
using System;
using System.Runtime.InteropServices;
public static class DshExecutionState {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint flags);
}
'@
Add-Type -TypeDefinition $source
$continuous = [Convert]::ToUInt32('80000000', 16)
$systemRequired = [uint32]0x00000001
try {
  $result = [DshExecutionState]::SetThreadExecutionState($continuous -bor $systemRequired)
  if ($result -eq 0) { throw 'SetThreadExecutionState failed' }
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  while ([Console]::In.ReadLine() -ne $null) { }
} finally {
  [void][DshExecutionState]::SetThreadExecutionState($continuous)
}
`;
const LINUX_HELPER = String.raw`
process.stdout.write('READY\n')
process.stdin.resume()
`;
const LINUX_INHIBIT_PATHS = ["/usr/bin/systemd-inhibit", "/bin/systemd-inhibit"];
var PowerInhibitor = class {
	listeners = /* @__PURE__ */ new Set();
	enabled = false;
	reasons = {
		runningSessions: 0,
		armedSchedules: 0,
		sessionStateKnown: false
	};
	phase = "disabled";
	child;
	retry;
	retryReset;
	retryIndex = 0;
	lastError;
	stopping = false;
	platform;
	pid;
	env;
	spawn;
	spawnSync;
	exists;
	execPath;
	timer;
	clearTimer;
	linuxProbe;
	constructor(options = {}) {
		this.platform = options.platform ?? process.platform;
		this.pid = options.pid ?? process.pid;
		this.env = options.env ?? process.env;
		this.spawn = options.spawn ?? ((file, args, spawnOptions) => spawn(file, [...args], spawnOptions));
		this.spawnSync = options.spawnSync ?? ((file, args, spawnOptions) => spawnSync(file, [...args], spawnOptions));
		this.exists = options.exists ?? existsSync;
		this.execPath = options.execPath ?? process.execPath;
		this.timer = options.setTimeout ?? globalThis.setTimeout;
		this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
	}
	setEnabled(enabled) {
		this.enabled = enabled;
		this.sync();
		this.emit();
	}
	updateReasons(reasons) {
		this.reasons = reasons;
		this.sync();
		this.emit();
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	snapshot() {
		return {
			platform: this.platform,
			phase: this.phase,
			enabled: this.enabled,
			...this.reasons,
			...this.lastError === void 0 ? {} : { lastError: this.lastError }
		};
	}
	dispose() {
		this.enabled = false;
		this.release();
		this.phase = "disabled";
		this.emit();
		this.listeners.clear();
	}
	desired() {
		return this.enabled && (!this.reasons.sessionStateKnown || this.reasons.runningSessions > 0 || this.reasons.armedSchedules > 0);
	}
	sync() {
		if (!this.enabled) {
			this.release();
			this.phase = "disabled";
			return;
		}
		if (this.platform !== "darwin" && this.platform !== "win32" && this.platform !== "linux") {
			this.release();
			this.phase = "unsupported";
			return;
		}
		if (this.platform === "linux" && this.linuxSystemdInhibit() === void 0) {
			this.release();
			this.phase = "unsupported";
			return;
		}
		if (!this.desired()) {
			this.release();
			this.phase = "idle";
			return;
		}
		if (this.child === void 0 && this.retry === void 0) this.acquire();
	}
	acquire() {
		this.phase = "acquiring";
		this.emit();
		this.stopping = false;
		try {
			const child = this.spawnCommand();
			this.child = child;
			let ready = false;
			let stderr = "";
			if (this.platform === "darwin") child.once("spawn", () => {
				ready = true;
				this.markReady(child);
			});
			child.stdout?.on("data", (chunk) => {
				if (!ready && chunk.toString("utf8").includes("READY")) {
					ready = true;
					this.markReady(child);
				}
			});
			child.stderr?.on("data", (chunk) => {
				stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2e3);
			});
			child.on("error", (error) => {
				this.fail(error, child);
			});
			child.on("exit", (code, signal) => {
				if (this.child !== child) return;
				this.child = void 0;
				if (this.stopping || !this.desired()) return;
				const detail = stderr.trim();
				this.fail(/* @__PURE__ */ new Error(`power helper exited (${String(code ?? signal ?? "unknown")})${detail === "" ? "" : `: ${detail}`}`));
			});
		} catch (error) {
			this.fail(error);
		}
	}
	markReady(child) {
		if (this.child !== child || !this.desired()) return;
		this.phase = "active";
		if (this.platform === "darwin") this.retryReset = this.timer(() => {
			this.retryReset = void 0;
			if (this.child === child && this.desired()) this.retryIndex = 0;
		}, DARWIN_STABLE_MS);
		else this.retryIndex = 0;
		this.lastError = void 0;
		this.emit();
	}
	fail(error, source) {
		if (source !== void 0 && this.child !== source) return;
		this.clearRetryReset();
		this.lastError = error instanceof Error ? error.message : String(error);
		this.phase = "error";
		this.emit();
		const child = this.child;
		this.child = void 0;
		child?.stdin?.end();
		child?.kill();
		if (!this.desired() || this.retry !== void 0) return;
		const delay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)];
		this.retryIndex += 1;
		this.retry = this.timer(() => {
			this.retry = void 0;
			if (this.desired()) this.acquire();
		}, delay);
	}
	release() {
		this.clearRetryReset();
		if (this.retry !== void 0) {
			this.clearTimer(this.retry);
			this.retry = void 0;
		}
		this.lastError = void 0;
		const child = this.child;
		this.child = void 0;
		if (child === void 0) return;
		this.stopping = true;
		if (this.platform === "win32" || this.platform === "linux") {
			child.stdin?.end();
			const force = this.timer(() => {
				if (child.exitCode === null) child.kill();
			}, 1e3);
			child.once("exit", () => {
				this.clearTimer(force);
			});
		} else child.kill("SIGTERM");
	}
	clearRetryReset() {
		if (this.retryReset === void 0) return;
		this.clearTimer(this.retryReset);
		this.retryReset = void 0;
	}
	windowsPowerShell() {
		const root = this.env.SystemRoot;
		if (root === void 0 || root.trim() === "") throw new Error("SystemRoot is unavailable");
		if (!win32.isAbsolute(root)) throw new Error("SystemRoot is not an absolute path");
		return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	}
	linuxSystemdInhibit() {
		if (this.linuxProbe !== void 0) return this.linuxProbe.available ? this.linuxProbe.executable : void 0;
		const executable = LINUX_INHIBIT_PATHS.find((path) => this.exists(path));
		if (executable === void 0) {
			this.linuxProbe = { available: false };
			return;
		}
		const probe = this.spawnSync(executable, ["--list", "--no-pager"], {
			stdio: "ignore",
			timeout: 2e3,
			windowsHide: true
		});
		this.linuxProbe = {
			executable,
			available: probe.status === 0 && probe.error === void 0
		};
		return this.linuxProbe.available ? executable : void 0;
	}
	spawnCommand() {
		if (this.platform === "darwin") return this.spawn("/usr/bin/caffeinate", [
			"-i",
			"-w",
			String(this.pid)
		], {
			shell: false,
			windowsHide: false,
			stdio: [
				"ignore",
				"ignore",
				"ignore"
			]
		});
		if (this.platform === "linux") {
			const executable = this.linuxSystemdInhibit();
			if (executable === void 0) throw new Error("systemd-inhibit is unavailable");
			return this.spawn(executable, [
				"--what=idle",
				"--who=DeepSeek Harness task board",
				"--why=DSH sessions are running or schedules are armed",
				"--mode=block",
				"--",
				this.execPath,
				"-e",
				LINUX_HELPER
			], {
				shell: false,
				windowsHide: false,
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				]
			});
		}
		return this.spawn(this.windowsPowerShell(), [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			WINDOWS_HELPER
		], {
			shell: false,
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
	}
	emit() {
		for (const listener of [...this.listeners]) listener();
	}
};
//#endregion
//#region src/host-service.ts
const SESSION_POLL_MS = 5e3;
const SCHEDULE_TICK_MS = 3e4;
const RESUME_GAP_MS = 45e3;
var TaskBoardHostService = class {
	ledger;
	runner;
	power;
	listeners = /* @__PURE__ */ new Set();
	timers = [];
	lastScheduleTick;
	disposed = false;
	pollInFlight = false;
	tickInFlight = false;
	active = true;
	preventIdleSleep = false;
	lastPowerJson = "";
	now;
	constructor(getApi, options = {}) {
		this.ledger = options.ledger ?? new HostTaskLedger();
		this.runner = new HostExecutionRunner(getApi, options.commandDispatcher, options.newSessionResolver);
		this.power = options.power ?? new PowerInhibitor();
		this.now = options.now ?? Date.now;
		this.executionReady = options.executionReady ?? (() => true);
		this.ledger.subscribe(() => {
			this.syncPowerReasons();
			this.emit();
		});
		this.power.subscribe(() => {
			const json = JSON.stringify(this.power.snapshot());
			if (json === this.lastPowerJson) return;
			this.lastPowerJson = json;
			this.emit();
		});
	}
	start() {
		if (this.disposed || this.timers.length > 0) return;
		this.syncPowerReasons();
		this.timers.push(setInterval(() => {
			this.schedulePoll();
		}, SESSION_POLL_MS));
		this.timers.push(setInterval(() => {
			this.scheduleTick(false);
		}, SCHEDULE_TICK_MS));
		this.schedulePoll();
		this.scheduleTick(true);
	}
	setConfiguration(active, preventIdleSleep) {
		const resumed = !this.active && active;
		this.active = active;
		this.preventIdleSleep = preventIdleSleep;
		if (resumed) {
			const current = this.power.snapshot();
			this.power.updateReasons({
				runningSessions: current.runningSessions,
				armedSchedules: this.armedSchedules(),
				sessionStateKnown: false
			});
		}
		this.power.setEnabled(active && preventIdleSleep);
		if (resumed) {
			this.schedulePoll();
			this.scheduleTick(true);
		}
		this.emit();
	}
	snapshot() {
		const state = this.ledger.state();
		return {
			schemaVersion: 2,
			revision: state.revision,
			tasks: state.tasks,
			scheduler: state.scheduler,
			power: this.power.snapshot()
		};
	}
	/** SSE frame payload; deliberately skips the tasks deep-clone of {@link snapshot}. */
	eventPayload() {
		const { revision, scheduler } = this.ledger.summary();
		return {
			revision,
			scheduler,
			power: this.power.snapshot()
		};
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	apply(requestId, action) {
		if (!this.active) throw new Error("task board is disabled");
		if (!this.ledger.hasRequest(requestId) && !['update', 'set-schedule'].includes(action.kind) && 'taskId' in action) {
			const task = this.ledger.state().tasks.find(item => item.id === action.taskId);
			const sid = task?.executions.at(-1)?.sessionId;
			if (sid !== undefined && this.executionReady(sid) !== true) throw new Error('owned Jobs are active or their state is unknown');
		}
		const result = this.ledger.applyRequest(requestId, action);
		if (result.run !== void 0) this.scheduleLaunch(result.run);
		return {
			schemaVersion: 2,
			revision: result.state.revision,
			tasks: result.state.tasks,
			scheduler: result.state.scheduler,
			power: this.power.snapshot()
		};
	}
	dispose() {
		this.disposed = true;
		for (const timer of this.timers.splice(0)) clearInterval(timer);
		this.power.dispose();
		this.ledger.dispose();
		this.listeners.clear();
	}
	async launch(opened) {
		try {
			const sessionId = await this.runner.launch(opened.task);
			this.ledger.attachSession(opened.task.id, opened.execution.id, sessionId);
		} catch (error) {
			if (error instanceof SessionLaunchError) this.ledger.attachSession(opened.task.id, opened.execution.id, error.sessionId);
			this.ledger.settle(opened.task.id, opened.execution.id, "failed", error instanceof Error ? error.message : String(error));
		}
	}
	async pollSessions() {
		if (this.disposed) return;
		if (!this.active && this.ledger.runtimeView().openExecutions.length === 0) return;
		const running = await this.runner.listRunning();
		const previous = this.power.snapshot();
		if (!running.known) {
			this.power.updateReasons({
				runningSessions: previous.runningSessions,
				armedSchedules: this.ledger.armedScheduleCount(),
				sessionStateKnown: false
			});
			return;
		}
		const runtime = this.ledger.runtimeView();
		this.power.updateReasons({
			runningSessions: running.count,
			armedSchedules: runtime.armedSchedules,
			sessionStateKnown: true
		});
		await this.reconcileExecutions(runtime.openExecutions);
	}
	/**
	* Settle every open execution whose session history already shows a
	* terminal turn (the local-fork inspect reads the history directly, so the
	* poll's session list is no longer needed here).
	*
	* Card [Q3] — this is also the post-restart recovery path (the Host starts
	* polling as soon as it boots, so every execution left open by the previous
	* instance comes through here). The liveness gate runs FIRST and is
	* mandatory: a restart can hand the turn over to the new instance, and
	* settling such an execution is a false settlement (2026-09-11 11:53: three
	* cards settled `succeeded` while their sessions kept running). Rules:
	* never settle a running session, never settle on an unreadable list, and
	* never settle a session that has not yet appeared in the list (it may still
	* be starting).
	*
	* 假 running 兜底 (2026-09-14): an execution whose session is proven dead may
	* still resolve `pending` for ever (an unreadable/huge history, no execution
	* boundary). Once it has been silent past {@link STALE_PENDING_SETTLE_MS} it
	* is settled `interrupted` rather than left running — see the inline comment
	* in the loop. The three rules above are untouched: the fallback only runs
	* where the liveness gate already said "determined, not alive".
	*/
	async reconcileExecutions(executions) {
		const attached = executions.filter((execution) => execution.sessionId !== void 0);
		if (attached.length === 0) return;
		const liveness = await this.runner.listSessionLiveness();
		for (const execution of attached) {
			const sessionId = execution.sessionId;
			const alive = isExecutionAlive(sessionId, liveness);
			if (!alive.determined) continue;
			if (alive.alive) continue;
			if (this.executionReady(sessionId) !== true) continue;
			if (alive.reason === "session-missing" && Date.now() - execution.startedAt < 3e4) continue;
			try {
				const result = await this.runner.inspect(sessionId, execution.startedAt, { sessionEnded: true });
				const fresh = isExecutionAlive(sessionId, await this.runner.listSessionLiveness());
				if (!fresh.determined || fresh.alive || this.executionReady(sessionId) !== true) continue;
				if (result.outcome !== "pending") {
					this.ledger.settle(execution.taskId, execution.executionId, result.outcome, "error" in result ? result.error : void 0);
					continue;
				}
				if (isStalePendingSettlement({
					sessionEnded: true,
					startedAt: execution.startedAt,
					lastActivityAt: liveness.lastActivity?.get(sessionId),
					now: this.now()
				})) this.ledger.settle(execution.taskId, execution.executionId, "interrupted", "execution session ended but its outcome stayed unresolvable (stale pending fallback)");
			} catch {}
		}
	}
	async tickSchedule(first) {
		if (this.disposed || !this.active) return;
		const now = this.now();
		const recovered = first || this.lastScheduleTick !== void 0 && now - this.lastScheduleTick > RESUME_GAP_MS;
		this.lastScheduleTick = now;
		this.ledger.setScheduler({ lastTickAt: now });
		if (recovered) {
			this.ledger.skipMissed(now);
			return;
		}
		for (const schedule of this.ledger.dueSchedules(now)) {
			const task = this.ledger.state().tasks.find(item => item.id === schedule.taskId);
			const sid = task?.executions.at(-1)?.sessionId;
			if (sid !== undefined && this.executionReady(sid) !== true) continue;
			const next = nextRunAtMs(schedule.cron, schedule.nextRunAt);
			const opened = this.ledger.openScheduled(schedule.taskId, next, now);
			if (opened !== void 0) this.scheduleLaunch(opened);
		}
	}
	armedSchedules() {
		return this.ledger.armedScheduleCount();
	}
	scheduleLaunch(opened) {
		this.launch(opened).catch((error) => {
			console.error("[dsh-task-board] execution launch settlement failed", error);
		});
	}
	schedulePoll() {
		if (this.pollInFlight || this.disposed) return;
		this.pollInFlight = true;
		this.pollSessions().catch((error) => {
			console.error("[dsh-task-board] session polling failed", error);
		}).finally(() => {
			this.pollInFlight = false;
		});
	}
	scheduleTick(first) {
		if (this.tickInFlight || this.disposed) return;
		this.tickInFlight = true;
		this.tickSchedule(first).catch((error) => {
			console.error("[dsh-task-board] scheduler tick failed", error);
		}).finally(() => {
			this.tickInFlight = false;
		});
	}
	syncPowerReasons() {
		const current = this.power.snapshot();
		this.power.updateReasons({
			runningSessions: current.runningSessions,
			armedSchedules: this.armedSchedules(),
			sessionStateKnown: current.sessionStateKnown
		});
		this.power.setEnabled(this.active && this.preventIdleSleep);
	}
	emit() {
		for (const listener of [...this.listeners]) listener();
	}
};
//#endregion
//#region src/http.ts
/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"referrer-policy": "no-referrer"
};
/**
* Write one JSON response. Default headers are the family defaults
* (content-type and referrer-policy); caller headers are appended or
* override them.
*/
function writeJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		...JSON_HEADERS,
		...headers
	});
	res.end(payload);
}
//#endregion
//#region src/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
/**
* Request-level trust fence: a loopback socket address AND a loopback Host
* header, plus browser same-origin markers. The socket address is
* authoritative; X-Forwarded-For is never trusted.
*/
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/host-routes.ts
const ACTION_LIMIT = 64 * 1024;
const IMPORT_LIMIT = 2 * 1024 * 1024;
const HEARTBEAT_MS = 15e3;
/** Header replaced by an authenticated same-host reverse proxy. */
const TASK_BOARD_PROXY_TOKEN_HEADER = "x-dsh-task-board-proxy-token";
function parseAuthority(authority) {
	if (authority.trim() !== authority) return void 0;
	const match = authority.startsWith("[") ? /^\[[^\]]+\](?::([0-9]+))?$/.exec(authority) : /^[^:@/?#\s]+(?::([0-9]+))?$/.exec(authority);
	if (match === null) return void 0;
	try {
		const url = new URL(`http://${authority}`);
		if (url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") return void 0;
		const rawPort = match[1];
		if (rawPort !== void 0 && (String(Number(rawPort)) !== rawPort || Number(rawPort) > 65535)) return void 0;
		return {
			canonical: url.hostname.toLowerCase() + (rawPort === void 0 ? "" : `:${rawPort}`),
			url
		};
	} catch {
		return;
	}
}
function resolveAccess(access) {
	const trustedProxyHosts = /* @__PURE__ */ new Set();
	for (const authority of access.trustedProxyHosts ?? []) {
		const parsed = parseAuthority(authority);
		if (parsed === void 0 || parsed.canonical !== authority.toLowerCase()) throw new Error(`task-board: trustedProxyHosts entry ${JSON.stringify(authority)} is not a canonical host[:port] authority`);
		trustedProxyHosts.add(parsed.canonical);
	}
	if (trustedProxyHosts.size > 0 && (access.proxyToken === void 0 || access.proxyToken === "")) throw new Error("task-board: authenticated proxy hosts require a non-empty proxy token");
	return {
		trustedProxyHosts,
		...access.proxyToken === void 0 ? {} : { proxyToken: access.proxyToken }
	};
}
/**
* Browser-signal tripwire, NOT an authority check: a bare curl sends neither
* header and is refused, but a curl with a forged Origin passes this too.
* The real boundary is the loopback socket + Host + origin-equality checks
* in isTrustedTaskBoardRequest below; do not rely on this marker alone.
*/
function browserSameOriginMarker(req) {
	return req.headers["sec-fetch-site"] === "same-origin" || typeof req.headers.origin === "string";
}
function sameAuthority(req, host) {
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === void 0) return req.headers["sec-fetch-site"] === "same-origin";
	try {
		return new URL(origin).host === host.host;
	} catch {
		return false;
	}
}
function matchesToken(candidate, expected) {
	if (typeof candidate !== "string" || expected === void 0 || candidate === "" || expected === "") return false;
	const actual = Buffer.from(candidate);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
/**
* Task-board route fence. Direct desktop access uses the repository-wide
* loopback socket + Host guard and additionally requires a browser same-origin
* marker: a bare local curl without any browser signal cannot exercise the
* agent control plane (a forged Origin does pass the marker — it is a
* tripwire, the socket/Host/origin-equality checks carry the authority).
* Authenticated proxies must be explicitly allowlisted and replace the
* internal token header after their own authentication step.
*/
function isTrustedTaskBoardRequest(req, access) {
	if (!browserSameOriginMarker(req)) return false;
	if (isLoopbackRequest(req)) return true;
	if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
	const host = req.headers.host;
	if (typeof host !== "string") return false;
	const parsed = parseAuthority(host);
	if (parsed === void 0 || parsed.canonical !== host.toLowerCase()) return false;
	if (!access.trustedProxyHosts.has(parsed.canonical) || !sameAuthority(req, parsed.url)) return false;
	return matchesToken(req.headers[TASK_BOARD_PROXY_TOKEN_HEADER], access.proxyToken);
}
async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > IMPORT_LIMIT) throw new Error("body-too-large");
		chunks.push(buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	return {
		raw,
		value: JSON.parse(raw)
	};
}
function makeTaskBoardRoutes(service, access = {}) {
	const resolvedAccess = resolveAccess(access);
	const guard = (req, res) => {
		if (isTrustedTaskBoardRequest(req, resolvedAccess)) return true;
		writeJson(res, 403, {
			ok: false,
			error: "forbidden"
		}, { "cache-control": "no-store" });
		return false;
	};
	return [
		{
			kind: "exact",
			path: `${TASK_BOARD_API_PREFIX}/state`,
			handler: (req, res) => {
				if (req.method !== "GET") return writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				}, { "cache-control": "no-store" });
				if (!guard(req, res)) return;
				writeJson(res, 200, service.snapshot(), { "cache-control": "no-store" });
			}
		},
		{
			kind: "exact",
			path: `${TASK_BOARD_API_PREFIX}/action`,
			handler: async (req, res) => {
				if (req.method !== "POST") return writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				}, { "cache-control": "no-store" });
				if (!guard(req, res)) return;
				if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return writeJson(res, 415, {
					ok: false,
					error: "json-required"
				}, { "cache-control": "no-store" });
				try {
					const body = await readBody(req);
					const parsed = parseActionEnvelope(body.value);
					if (parsed === void 0) return writeJson(res, 400, {
						ok: false,
						error: "invalid-action"
					}, { "cache-control": "no-store" });
					if (parsed.action.kind !== "import" && Buffer.byteLength(body.raw) > ACTION_LIMIT) return writeJson(res, 413, {
						ok: false,
						error: "body-too-large"
					}, { "cache-control": "no-store" });
					writeJson(res, 200, service.apply(parsed.requestId, parsed.action), { "cache-control": "no-store" });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					writeJson(res, message === "body-too-large" ? 413 : 400, {
						ok: false,
						error: message
					}, { "cache-control": "no-store" });
				}
			}
		},
		{
			kind: "exact",
			path: `${TASK_BOARD_API_PREFIX}/events`,
			handler: (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405);
					res.end();
					return;
				}
				if (!guard(req, res)) return;
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
					connection: "keep-alive"
				});
				const push = () => {
					const payload = service.eventPayload();
					res.write(`data: ${JSON.stringify(payload)}\n\n`);
				};
				const unsubscribe = service.subscribe(push);
				const heartbeat = setInterval(() => {
					res.write(": ping\n\n");
				}, HEARTBEAT_MS);
				const close = () => {
					clearInterval(heartbeat);
					unsubscribe();
				};
				req.once("close", close);
				res.once("close", close);
				push();
			}
		}
	];
}
//#endregion
//#region src/mount-once.ts
/**
* Host single-instance guard shared by the plugin family. The family bundle
* (dsh-web-all / dsh-skins) namespaces every child row id (web-ui-*), so
* the loader accepts a standalone install of the same package side by side;
* without this guard the second instance would still re-register the same
* webserver routes, tools, settings namespaces, and system-prompt sections
* and fail the boot. mountOnce makes the second host apply a no-op for the
* lifetime of the first instance (the browser half is already deduped by
* package name in the client module host).
*
* The registry rides a global symbol so two module instances of the same
* package (npm copy vs repository link) still share one verdict. cordis
* `ctx.effect` runs its callback immediately and treats the callback's
* return value as the fiber disposer, so the unmarker is returned, not run.
*/
const MOUNTED = Symbol.for("dsh-web.mounted-plugins");
function mountedSet() {
	const registry = globalThis;
	return registry[MOUNTED] ??= /* @__PURE__ */ new Set();
}
/**
* Wrap a cordis plugin apply so the package runs at most once per process.
* The first mount registers normally and unmarks when its fiber disposes;
* any later mount of the same package name is a no-op.
* @param packageName - npm package identity shared by every install source.
* @param fn - the original plugin apply.
* @returns an apply of the same shape.
*/
function mountOnce(packageName, fn) {
	return ((...args) => {
		const mounted = mountedSet();
		if (mounted.has(packageName)) return;
		mounted.add(packageName);
		args[0]?.effect?.(() => () => {
			mounted.delete(packageName);
		});
		return fn(...args);
	});
}
//#endregion
//#region src/settings-compat.ts
/**
* Install a plugin's optional settings wiring on whichever API generation the
* running Host provides.
* @param ctx - the plugin context (owner of the registration).
* @param ns - settings namespace (a lowercase hyphenated identifier).
* @param schema - schemastery schema resolving the namespace's value.
* @param entry - composition entry, used as the base and the fallback value.
* @param hooks - source sink and change notification.
*/
function installSettingsCompat(ctx, ns, schema, entry, hooks) {
	ctx.inject([SVC.settings], (settingsCtx) => {
		const seam = settingsCtx.settings;
		if (seam !== void 0 && typeof seam.installSection === "function") {
			seam.installSection(ctx, ns, schema, entry, hooks);
			return;
		}
		import("@deepseek-ai/dsh-settings").then((mod) => {
			const legacy = mod.installSettingsSection;
			if (typeof legacy !== "function") return;
			legacy(ctx, ns, schema, entry, hooks);
		}).catch(() => {});
	});
}
//#endregion
//#region src/index.ts
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200;
/** Default environment variable holding the authenticated proxy token. */
const DEFAULT_PROXY_TOKEN_ENV = "DSH_TASK_BOARD_PROXY_TOKEN";
/**
* Static loader declarations.
*
* ⚠️ `apiProxy` is deliberately **absent** from this list (2026-09-14, card
* `升级 B2` step ④). `@deepseek-ai/dsh-host-apiproxy` does not exist in the
* 0.1.5 closure (it was split into per-domain services), and a static
* declaration of a service the host never provides leaves this entry
* permanently `pending` — i.e. `dsh: 1 entry did not activate`, which is
* equivalent to a boot failure (measured on the canary with
* `make-min-profile.mjs --keep dsh-task-board-local`).
*
* The service is therefore resolved **at call time** via {@link resolveApiProxy}
* (`ctx.get`, which never throws when the service is missing — reading an
* undeclared service *property* does throw in cordis). On the 0.1.1 line
* nothing changes: the service resolves and every call path behaves exactly as
* before. On a line without it the board still boots — UI, ledger and the cron
* scheduler stay functional — and only session execution (`run`/`rerun`) is
* disabled, with an explicit error instead of a silent no-op.
*/
const inject = [
	SVC.systemPrompt,
	SVC.webServer,
	SVC.agents,
	SVC.commands
];
/**
* Build a **late-binding** accessor for the `apiProxy` service.
*
* Resolution is per call on purpose: at `apply` time the service may not be
* registered yet on either line, so probing once here would bake a wrong
* answer into the runner for the whole process lifetime.
*/
function resolveApiProxy(ctx) {
	return () => {
		try {
			const get = ctx.get;
			if (typeof get !== "function") return null;
			return get.call(ctx, SVC.apiProxy) ?? null;
		} catch {
			return null;
		}
	};
}
/**
* Build a **late-binding** accessor for the 0.1.5-line session service
* (`sessionController`, `@deepseek-ai/dsh-api-session-controller`).
*
* The legacy `apiProxy` domain was split into per-domain services on the
* 0.1.5 line, and the session domain is `sessionController` — the same service
* the Host's own web client drives. This plugin executes board sessions
* through it (`create` → `rename` → `prompt`) and reads its session index
* (`list`) and logs (`inspect` / `page`).
*
* Deliberately **not** in `inject`: exactly like `apiProxy`, this service does
* not exist on the other host line, and a static declaration of an absent
* service leaves the entry permanently `pending` (= `1 entry did not
* activate`, i.e. boot failure). Both lines are therefore resolved at call
* time, and only the intersection of their service sets is declared statically.
*
* The returned accessor re-resolves on every call: at `apply` time neither
* line is guaranteed to have registered the service yet, so probing once here
* would bake a wrong answer into the runner for the whole process lifetime.
*/
function resolveSessionController(ctx) {
	return () => {
		try {
			return asNewLineSessionApi(service(ctx, SVC.sessionController));
		} catch {
			return null;
		}
	};
}
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const TASK_BOARD_GUIDANCE = "本机已安装 dsh-task-board-local 插件（DSH Web GUI 的任务看板，本地自建版）：侧边栏「任务看板」入口。能力：六列看板（待规划/待办/进行中/待验收/已完成/已失败）；人工验收闸门——执行会话结算成功只进「待验收」，必须人工点「验收通过」才进已完成（定时卡验收后回待办继续待命），点「打回」回待办并可附备注；卡片分三类 kind：once（一次性）/recurring（定时重复，跑完进待验收、验收后回待办）/interactive（交互式，禁加定时，须人工推进）；Host 权威账本；关闭浏览器后仍由 Host 执行和结算；任务可钉住工作区、agent 预设和权限；支持 Host 本地时区的 5 段 cron，错过的触发点不补跑；可选且默认关闭的空闲系统睡眠保护允许屏幕熄灭，但不承诺拦截合盖、手动睡眠、休眠、关机或唤醒已睡眠机器；已执行卡可补写备注（description），标题与 Prompt 执行后只读。执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。若你同时用 todo_write 维护会话顶部的可见计划列表，最终回复前必须再次调用 todo_write 收尾：没有剩余工作时不要保留 in_progress，已完成的最后一步要标为 completed。";
/**
* Settings namespace of the board's announcement capability — the section the
* web settings surface edits.
*
* Spelled as a literal on purpose. This value used to come from the
* `settingsNamespace()` helper of `@deepseek-ai/dsh-settings`; that export (like
* `installSettingsSection`) was removed on 0.1.2+, and a static import of
* either one fails the whole loader entry at boot — the module system rejects
* the named import before any plugin code runs. The runtime value was always
* this bare string, and both API generations accept it.
*/
const TASK_BOARD_SETTINGS_NAMESPACE = "task-board";
const Config = z.object({
	announceToAgent: z.boolean().default(false),
	enabled: z.boolean().default(true),
	preventIdleSleep: z.boolean().default(false),
	trustedProxyHosts: z.array(z.string()).default([]),
	proxyTokenEnv: z.string().min(1).default(DEFAULT_PROXY_TOKEN_ENV)
});
/** Resolve proxy access without ever placing the token value in plugin config. */
function resolveProxyAccess(config, env = process.env) {
	const trustedProxyHosts = config?.trustedProxyHosts ?? [];
	if (trustedProxyHosts.length === 0) return { trustedProxyHosts };
	const proxyTokenEnv = config?.proxyTokenEnv ?? "DSH_TASK_BOARD_PROXY_TOKEN";
	if (proxyTokenEnv.trim() === "") throw new Error("task-board: proxyTokenEnv must not be empty");
	const proxyToken = env[proxyTokenEnv];
	if (proxyToken === void 0 || proxyToken === "") throw new Error(`task-board: trustedProxyHosts requires a non-empty ${proxyTokenEnv} environment variable`);
	return {
		trustedProxyHosts,
		proxyToken
	};
}
/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = false;
/**
* Register the board's announcement section, gated on the composition entry's
* `announceToAgent` (and the live settings value once the web settings
* surface is served). The section is re-registered whenever the source
* changes, so a settings edit takes effect without a restart.
* @param ctx - the plugin context (systemPrompt injected).
* @param config - resolved plugin config (schema defaults applied by the loader).
*/
const apply = mountOnce("@linxin666/dsh-client-ui-task-board", applyImpl);
function applyImpl(ctx, config) {
	const host = new TaskBoardHostService(resolveApiProxy(ctx), {
		commandDispatcher: { async execute(sessionId, line, signal) {
			const agent = ctx.agents.get(sessionId);
			if (agent === void 0) throw new Error(`execution session ${sessionId} is not available`);
			return (await ctx.commands.execute(agent, line, [], signal))?.result;
		} },
		executionReady: (sessionId) => executionState(ctx, sessionId).settled,
		newSessionResolver: resolveSessionController(ctx)
	});
	host.setConfiguration(config?.enabled ?? true, config?.preventIdleSleep ?? false);
	host.start();
	ctx.commands.register(boardCommand(ctx, host));
	ctx.effect(() => {
		const disposers = [];
		try {
			for (const route of makeTaskBoardRoutes(host, resolveProxyAccess(config))) disposers.push(ctx.webServer.register(route));
		} catch (error) {
			for (const dispose of disposers) dispose();
			host.dispose();
			throw error;
		}
		return () => {
			for (const dispose of disposers) dispose();
			host.dispose();
		};
	}, "task-board: host ledger, scheduler, and routes");
	let current = () => config ?? {};
	let disposeSection;
	const sync = () => {
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		const active = current().enabled ?? true;
		host.setConfiguration(active, current().preventIdleSleep ?? false);
		if (!active) return;
		if ((current().announceToAgent ?? DEFAULT_ANNOUNCE) === false) return;
		disposeSection = ctx.systemPrompt.section({
			name: "plugin:task-board",
			order: SECTION_ORDER,
			text: TASK_BOARD_GUIDANCE
		});
	};
	installSettingsCompat(ctx, TASK_BOARD_SETTINGS_NAMESPACE, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
		},
		onChange: sync
	});
	sync();
}
//#endregion
export { Config, DEFAULT_PROXY_TOKEN_ENV, HostTaskLedger, TASK_BOARD_GUIDANCE, TASK_BOARD_SETTINGS_NAMESPACE, apply, inject, resolveApiProxy, resolveProxyAccess, resolveSessionController };
