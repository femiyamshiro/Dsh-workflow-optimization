window.__ModuleLoader__.load({
	id: "@kira905/dsh-task-board-local",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/** The six kanban columns, in display order. */
		const COLUMNS = [
			{
				status: "backlog",
				label: "待规划"
			},
			{
				status: "todo",
				label: "待办"
			},
			{
				status: "running",
				label: "进行中"
			},
			{
				status: "review",
				label: "待验收"
			},
			{
				status: "done",
				label: "已完成"
			},
			{
				status: "failed",
				label: "已失败"
			}
		];
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
		/** A settled-execution summary string for the detail view. */
		function executionLabel(execution) {
			if (execution.result === "succeeded") return "succeeded";
			if (execution.result === "failed") return "failed";
			if (execution.result === "cancelled") return "cancelled";
			if (execution.result === "interrupted") return "interrupted";
			return "running";
		}
		/**
		* Distinct main lines (主线) across a ledger, sorted for stable pickers and
		* the line view. Unassigned cards are skipped: they surface as the board's
		* 未归线 bucket instead of becoming a group of their own.
		*/
		function collectLines(tasks) {
			const seen = /* @__PURE__ */ new Set();
			for (const task of tasks) if (task.line !== void 0 && task.line !== "") seen.add(task.line);
			return [...seen].sort((a, b) => a.localeCompare(b, "zh"));
		}
		/** The first integer embedded in a node label (`H10-x` → 10), or undefined. */
		function firstNumber(label) {
			const match = /\d+/.exec(label);
			return match === null ? void 0 : Number.parseInt(match[0], 10);
		}
		/**
		* Order two node labels inside a line: the first embedded number decides, so
		* `H2` precedes `H10` and `[4]` precedes `[10]`. A label without any number
		* sorts after the numbered ones; ties fall back to a locale comparison.
		*/
		function compareSeq(a, b) {
			const left = a === void 0 ? void 0 : firstNumber(a);
			const right = b === void 0 ? void 0 : firstNumber(b);
			if (left !== void 0 && right !== void 0 && left !== right) return left - right;
			if (left !== void 0 && right === void 0) return -1;
			if (left === void 0 && right !== void 0) return 1;
			return (a ?? "").localeCompare(b ?? "", "zh");
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
		* Whether a task's identity may still be edited: the task must be on-board
		* (not archived) and must never have started executing. Fail-closed: a
		* running, settled, or cancelled-before-launch task keeps title/prompt fixed.
		*/
		function canEditTaskIdentity(task) {
			return task.archivedAt === void 0 && task.status !== "running" && task.executions.length === 0;
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
		//#region src/core/controller.ts
		/** The selected task (resolved from the ledger), or undefined. */
		function selectedTaskOf(snapshot) {
			if (snapshot.selectedTaskId === void 0) return void 0;
			return snapshot.tasks.find((task) => task.id === snapshot.selectedTaskId);
		}
		function randomUuid() {
			const randomUUID = globalThis.crypto?.randomUUID;
			if (randomUUID !== void 0) return randomUUID.call(globalThis.crypto);
			const bytes = globalThis.crypto?.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
			if (bytes === void 0) return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
			bytes[6] = bytes[6] & 15 | 64;
			bytes[8] = bytes[8] & 63 | 128;
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		/** Read the current selection off a session-list snapshot (structural). */
		function currentOf(sessions) {
			return sessions.list.getSnapshot().current;
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Board controller (see module doc). All mutations bump the snapshot and
		* persist through the store; UI and DOM mounts subscribe and re-render.
		*/
		var BoardController = class {
			deps;
			tasks = [];
			boardOpen = false;
			archiveView = false;
			selectedTaskId;
			executionOptions = {
				workspaces: [],
				presets: []
			};
			listeners = /* @__PURE__ */ new Set();
			disposers = [];
			now;
			uuid;
			pendingTaskIds = /* @__PURE__ */ new Set();
			taskQueues = /* @__PURE__ */ new Map();
			transportError;
			hostState;
			/** Release of the live Host event channel; held only while the board is on screen. */
			remoteStreamRelease;
			/** True once the Host bootstrap succeeded (the channel may then be opened). */
			remoteStreamReady = false;
			/** Page visibility; a hidden tab holds no event channel. */
			documentVisible = true;
			remoteInitialization;
			/** @param deps - store and the sessions navigation face. */
			constructor(deps) {
				this.deps = deps;
				this.now = deps.now ?? (() => Date.now());
				this.uuid = deps.uuid ?? randomUuid;
			}
			/** Load the persisted ledger and start the navigation/status subscriptions. */
			start() {
				this.tasks = this.deps.store.load();
				if (this.deps.transport !== void 0) this.initializeRemote();
				const unsubscribeExternal = this.deps.transport === void 0 ? this.deps.store.subscribeExternal?.(() => {
					this.tasks = this.deps.store.load();
					this.notify();
				}) : void 0;
				if (unsubscribeExternal !== void 0) this.disposers.push(unsubscribeExternal);
				this.disposers.push(this.deps.sessions.list.subscribe(() => {
					this.onSessionsChanged();
				}));
				this.notify();
			}
			/** Stop all subscriptions and drop retained state (idempotent). */
			dispose() {
				this.remoteStreamRelease?.();
				this.remoteStreamRelease = void 0;
				for (const dispose of this.disposers.splice(0)) dispose();
				this.listeners.clear();
			}
			getSnapshot() {
				return {
					tasks: this.tasks,
					boardOpen: this.boardOpen,
					archiveView: this.archiveView,
					selectedTaskId: this.selectedTaskId,
					executionOptions: this.executionOptions,
					pendingTaskIds: [...this.pendingTaskIds],
					...this.transportError === void 0 ? {} : { transportError: this.transportError },
					...this.hostState === void 0 ? {} : { host: this.hostState }
				};
			}
			subscribe(fn) {
				this.listeners.add(fn);
				return () => {
					this.listeners.delete(fn);
				};
			}
			/** Whether production mutations are confirmed by the Host transport. */
			isHostBacked() {
				return this.deps.transport !== void 0;
			}
			/** Retry initial migration/state synchronization after an explicit Host error. */
			async retryHostSync() {
				return await this.initializeRemote();
			}
			openBoard() {
				if (this.boardOpen) return;
				this.lastCurrent = currentOf(this.deps.sessions);
				this.boardOpen = true;
				this.syncRemoteStream();
				this.notify();
			}
			closeBoard() {
				if (!this.boardOpen) return;
				this.boardOpen = false;
				this.syncRemoteStream();
				this.notify();
			}
			toggleBoard() {
				if (this.boardOpen) this.closeBoard();
				else this.openBoard();
			}
			/**
			* Track page visibility for the live channel: a hidden tab (background
			* window, another tab in front) releases it, and the next visible moment
			* re-subscribes and refreshes once. Called by the wiring on
			* `visibilitychange`; the default is visible.
			* @param visible - whether the document is currently visible.
			*/
			setDocumentVisible(visible) {
				if (this.documentVisible === visible) return;
				this.documentVisible = visible;
				this.syncRemoteStream();
			}
			/**
			* Switch between the kanban columns and the archive view. Leaving the
			* archive view with an archived task still selected closes the selection —
			* the detail overlay must not linger over a task that is off-board.
			*/
			toggleArchiveView() {
				this.archiveView = !this.archiveView;
				if (!this.archiveView && this.selectedTaskId !== void 0) {
					if (this.tasks.find((task) => task.id === this.selectedTaskId)?.archivedAt !== void 0) this.selectedTaskId = void 0;
				}
				this.notify();
			}
			openTask(id) {
				if (this.tasks.some((task) => task.id === id)) {
					this.selectedTaskId = id;
					this.notify();
				}
			}
			closeTask() {
				if (this.selectedTaskId === void 0) return;
				this.selectedTaskId = void 0;
				this.notify();
			}
			createTask(input) {
				const id = this.uuid();
				const { task, tasks } = applyCreateTask(this.tasks, input, this.now(), id);
				if (task === void 0) return void 0;
				this.tasks = [...tasks];
				this.persistAndNotify();
				return task;
			}
			/** Create through the Host and expose the task only after confirmation. */
			async createTaskConfirmed(input) {
				if (this.deps.transport === void 0) return this.createTask(input);
				const id = this.uuid();
				if (applyCreateTask(this.tasks, input, this.now(), id).task === void 0) return void 0;
				return await this.commitRemote({
					kind: "create",
					id,
					input
				}, id) ? this.tasks.find((task) => task.id === id) : void 0;
			}
			/**
			* Apply an editable-field patch (task content + execution targets).
			* Host-backed: the Host ledger owns the fail-closed checks (the content of
			* an executed task is read-only) and confirms the mutation, so the resolved
			* value reflects whether the Host accepted it; the legacy in-memory path
			* applies and persists synchronously.
			* @returns true when the patch was accepted by the authority.
			*/
			async updateTask(id, patch) {
				if (this.deps.transport !== void 0) return await this.commitRemote({
					kind: "update",
					taskId: id,
					patch
				}, id);
				this.tasks = [...applyUpdateTask(this.tasks, id, patch, this.now())];
				this.persistAndNotify();
				return true;
			}
			/**
			* Replace (a part of) the picker option sets the UI feeds (workspace list
			* and agent-preset roster come from the runtime, not the ledger).
			*/
			setExecutionOptions(patch) {
				this.executionOptions = {
					...this.executionOptions,
					...patch
				};
				this.notify();
			}
			moveTask(id, status) {
				if (this.deps.transport !== void 0) {
					this.commitRemote({
						kind: "move",
						taskId: id,
						status
					}, id);
					return;
				}
				this.tasks = this.tasks.map((task) => task.id === id ? withStatus(task, status, this.now()) : task);
				this.persistAndNotify();
			}
			deleteTask(id) {
				if (this.deps.transport !== void 0) {
					this.commitRemote({
						kind: "delete",
						taskId: id
					}, id);
					return;
				}
				const { tasks, selectionCleared } = applyDeleteTask(this.tasks, this.selectedTaskId, id);
				this.tasks = [...tasks];
				if (selectionCleared) this.selectedTaskId = void 0;
				this.persistAndNotify();
			}
			/**
			* Archive a settled task (done/failed). Running or on-board-unsettled
			* tasks are refused so the runner keeps exclusive ownership of their
			* lifecycle.
			* @returns true when applied.
			*/
			archiveTask(id) {
				const { tasks, archived } = applyArchiveTask(this.tasks, id, this.now());
				if (!archived) return false;
				if (this.deps.transport !== void 0) {
					this.commitRemote({
						kind: "archive",
						taskId: id
					}, id);
					return true;
				}
				this.tasks = [...tasks];
				this.persistAndNotify();
				return true;
			}
			/** Restore an archived task back onto the board (same status column). */
			restoreTask(id) {
				const { tasks, archived } = applyRestoreTask(this.tasks, id, this.now());
				if (!archived) return false;
				if (this.deps.transport !== void 0) {
					this.commitRemote({
						kind: "restore",
						taskId: id
					}, id).then((restored) => {
						if (restored && this.selectedTaskId === id) this.closeTask();
					});
					return true;
				}
				this.tasks = [...tasks];
				if (this.selectedTaskId === id) this.selectedTaskId = void 0;
				this.persistAndNotify();
				return true;
			}
			/**
			* Update a task's schedule rule. A blank or invalid cron expression is
			* rejected (returns false, state untouched). When the rule ends up enabled
			* the next run instant is computed immediately; a disabled rule carries no
			* next-run instant. Delegates the domain transition to the schedule use case.
			* @param id - the task to schedule.
			* @param patch - fields to change (absent fields keep their current value).
			* @returns true when applied, false when rejected (invalid cron / unknown task).
			*/
			setSchedule(id, patch) {
				const { tasks, applied } = applySetSchedule(this.tasks, id, patch, this.now());
				if (!applied) return false;
				if (this.deps.transport !== void 0) {
					this.commitRemote({
						kind: "set-schedule",
						taskId: id,
						patch
					}, id);
					return true;
				}
				this.tasks = [...tasks];
				this.persistAndNotify();
				return true;
			}
			/**
			* Legacy pure-controller seam retained for migration-focused tests. The
			* production browser never rolls schedules; the Host ledger owns them.
			*/
			applyScheduleNextRun(id, nextRunAt, lastTriggeredAt) {
				const next = applyScheduleNextRun(this.tasks, id, nextRunAt, lastTriggeredAt, this.now());
				this.tasks = [...next];
				this.persistAndNotify();
			}
			/**
			* Reload the legacy v1 store without notifying subscribers. Production v2
			* reads Host snapshots instead; this remains only for isolated legacy tests.
			*/
			reloadFromStore() {
				this.tasks = this.deps.store.load();
			}
			/**
			* Jump to an execution's session transcript. Selecting the session changes
			* `current`, which closes the board (the conversation view takes over).
			* @param sessionId - the execution session to open.
			*/
			openSession(sessionId) {
				this.deps.sessions.open(sessionId);
			}
			/**
			* Request a Host execution for a task: the Host ledger owns the running
			* transition, the execution record, and the settlement. A second call
			* while the task is already running is ignored; without a Host transport
			* the run is refused (returns false).
			*/
			async runTask(id) {
				const task = this.tasks.find((candidate) => candidate.id === id);
				if (task === void 0 || task.archivedAt !== void 0 || task.status === "running") return false;
				if (this.deps.transport === void 0) return false;
				return await this.commitRemote({
					kind: "run",
					taskId: id
				}, id);
			}
			/** Re-run a settled task through the Host (the Host replans and executes). */
			async rerunTask(id) {
				const task = this.tasks.find((candidate) => candidate.id === id);
				if (task === void 0 || task.archivedAt !== void 0) return;
				if (this.deps.transport === void 0) return;
				await this.commitRemote({
					kind: "rerun",
					taskId: id
				}, id);
			}
			/**
			* Accept a card parked in the human review column (local fork): a one-off
			* card lands in done, a recurring card returns to todo for its next trigger.
			* Host-backed only — the Host owns the transition.
			*/
			async confirmTask(id) {
				const task = this.tasks.find((candidate) => candidate.id === id);
				if (task === void 0 || task.archivedAt !== void 0 || task.status !== "review") return false;
				if (this.deps.transport === void 0) return false;
				return await this.commitRemote({
					kind: "confirm",
					taskId: id
				}, id);
			}
			/** Send a reviewed card back to todo, optionally appending a rejection note. */
			async rejectTask(id, note) {
				const task = this.tasks.find((candidate) => candidate.id === id);
				if (task === void 0 || task.archivedAt !== void 0 || task.status !== "review") return false;
				if (this.deps.transport === void 0) return false;
				const trimmed = note?.trim();
				return await this.commitRemote({
					kind: "reject",
					taskId: id,
					...trimmed === void 0 || trimmed === "" ? {} : { note: trimmed }
				}, id);
			}
			/**
			* Whether the live Host event channel is needed right now: only while the
			* board is actually on screen (open panel, visible document, Host ready).
			* A closed board or a hidden tab runs without an EventSource, so the page
			* keeps that HTTP/1.1 connection slot free.
			*/
			wantsRemoteStream() {
				return this.deps.transport !== void 0 && this.boardOpen && this.documentVisible && this.remoteStreamReady;
			}
			/**
			* Acquire or release the live channel to match {@link wantsRemoteStream}.
			* On acquire the board subscribes first — no frame can slip between the
			* subscribe and the catch-up read — and then pulls one full snapshot,
			* because the channel was closed while the board was away and the ledger
			* may have moved on. On release the EventSource is closed.
			*/
			syncRemoteStream() {
				const transport = this.deps.transport;
				if (transport === void 0) return;
				if (this.wantsRemoteStream()) {
					if (this.remoteStreamRelease !== void 0) return;
					this.remoteStreamRelease = transport.subscribe((event) => {
						this.onRemoteEvent(event);
					});
					this.refreshRemote();
					return;
				}
				this.releaseRemoteStream();
			}
			/** Close the live channel when held (idempotent). */
			releaseRemoteStream() {
				const release = this.remoteStreamRelease;
				if (release === void 0) return;
				this.remoteStreamRelease = void 0;
				release();
			}
			/** Close the board when the user navigates to another session. */
			onSessionsChanged() {
				if (!this.boardOpen) return;
				const current = currentOf(this.deps.sessions);
				if (current !== this.lastCurrent) this.closeBoard();
				this.lastCurrent = current;
			}
			lastCurrent = void 0;
			persistAndNotify() {
				if (this.deps.transport === void 0) this.deps.store.save(this.tasks);
				this.notify();
			}
			async commitRemote(action, taskId) {
				if (this.deps.transport === void 0) return true;
				if (taskId === void 0) return await this.performRemote(action);
				const operation = (this.taskQueues.get(taskId) ?? Promise.resolve()).catch(() => {}).then(async () => await this.performRemote(action));
				const tail = operation.then(() => {}, () => {});
				this.taskQueues.set(taskId, tail);
				this.pendingTaskIds.add(taskId);
				this.notify();
				try {
					return await operation;
				} finally {
					if (this.taskQueues.get(taskId) === tail) {
						this.taskQueues.delete(taskId);
						this.pendingTaskIds.delete(taskId);
						this.notify();
					}
				}
			}
			async performRemote(action) {
				const transport = this.deps.transport;
				if (transport === void 0) return true;
				this.transportError = void 0;
				this.notify();
				try {
					return this.acceptRemote(await transport.action(action)) || await this.refreshRemote();
				} catch (error) {
					await this.refreshRemote(messageOf(error));
					return false;
				}
			}
			async initializeRemote() {
				if (this.remoteInitialization !== void 0) return await this.remoteInitialization;
				const initialization = this.doInitializeRemote();
				this.remoteInitialization = initialization;
				try {
					return await initialization;
				} finally {
					if (this.remoteInitialization === initialization) this.remoteInitialization = void 0;
				}
			}
			async doInitializeRemote() {
				const transport = this.deps.transport;
				if (transport === void 0) return true;
				try {
					this.acceptRemote(await transport.bootstrap(this.tasks));
					this.remoteStreamReady = true;
					this.syncRemoteStream();
					return true;
				} catch (error) {
					this.transportError = messageOf(error);
					this.notify();
					return false;
				}
			}
			/**
			* SSE frames carry revision/scheduler/power. When the revision matches the
			* one already applied, apply the frame's scheduler/power in place and skip
			* the full /state fetch; otherwise the 5 s heartbeat would re-clone and
			* re-serialize the whole ledger per tab even while nothing changes.
			*/
			onRemoteEvent(event) {
				if (event !== void 0 && this.hostState !== void 0 && event.revision === this.hostState.revision && typeof event.scheduler === "object" && event.scheduler !== null && typeof event.power === "object" && event.power !== null) {
					this.hostState = {
						revision: event.revision,
						scheduler: event.scheduler,
						power: event.power
					};
					this.notify();
					return;
				}
				this.refreshRemote();
			}
			async refreshRemote(preserveError) {
				const transport = this.deps.transport;
				if (transport === void 0) return true;
				try {
					this.acceptRemote(await transport.state());
					if (preserveError !== void 0) {
						this.transportError = preserveError;
						this.notify();
					}
					return true;
				} catch (error) {
					this.transportError = preserveError ?? messageOf(error);
					this.notify();
					return false;
				}
			}
			acceptRemote(snapshot) {
				if (this.hostState?.scheduler.ledgerId === snapshot.scheduler.ledgerId && this.hostState !== void 0 && snapshot.revision < this.hostState.revision) return false;
				this.tasks = [...snapshot.tasks];
				this.hostState = {
					revision: snapshot.revision,
					scheduler: snapshot.scheduler,
					power: snapshot.power
				};
				this.transportError = void 0;
				if (this.selectedTaskId !== void 0 && !this.tasks.some((task) => task.id === this.selectedTaskId)) this.selectedTaskId = void 0;
				if (!this.archiveView && this.selectedTaskId !== void 0 && this.tasks.find((task) => task.id === this.selectedTaskId)?.archivedAt !== void 0) this.selectedTaskId = void 0;
				this.notify();
				return true;
			}
			notify() {
				for (const fn of [...this.listeners]) fn();
			}
		};
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
		/** Storage key for the task ledger document. */
		const DEFAULT_STORAGE_KEY = "dsh.taskBoard.v1";
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
		/** localStorage-backed store (the browser backend). */
		var LocalStorageTaskStore = class {
			key;
			storage;
			events;
			/**
			* @param key - storage key for the ledger document.
			* @param storage - storage backend (defaults to the global localStorage; tests inject fakes).
			* @param events - storage-event target for cross-tab notifications (defaults
			*   to the browser global; undefined in non-browser runtimes, where the
			*   subscription becomes a no-op).
			*/
			constructor(key = DEFAULT_STORAGE_KEY, storage = globalThis.localStorage, events = typeof globalThis.addEventListener === "function" ? globalThis : void 0) {
				this.key = key;
				this.storage = storage;
				this.events = events;
			}
			load() {
				if (this.storage === void 0) return [];
				try {
					return parseLedger(this.storage.getItem(this.key));
				} catch (error) {
					console.error("[dsh-task-board] task ledger read failed; starting empty", error);
					return [];
				}
			}
			save(tasks) {
				if (this.storage === void 0) return;
				try {
					this.storage.setItem(this.key, JSON.stringify(tasks));
				} catch (error) {
					console.error("[dsh-task-board] task ledger write failed (persistence skipped)", error);
				}
			}
			clear() {
				if (this.storage === void 0) return;
				try {
					this.storage.removeItem(this.key);
				} catch (error) {
					console.error("[dsh-task-board] task ledger clear failed", error);
				}
			}
			/**
			* Cross-tab change subscription (see {@link TaskStore.subscribeExternal}).
			* The browser fires the storage event in every OTHER tab of the same origin
			* when one tab writes; a null key means the whole storage was cleared. Both
			* cases reload the ledger here; unrelated keys are ignored.
			*/
			subscribeExternal(listener) {
				if (this.events === void 0) return () => {};
				const onStorage = (event) => {
					if (event.key !== null && event.key !== this.key) return;
					listener();
				};
				this.events.addEventListener("storage", onStorage);
				return () => {
					this.events?.removeEventListener("storage", onStorage);
				};
			}
		};
		//#endregion
		//#region src/client/apply-guard.ts
		/** Claims the plugin apply slot. Returns true when this call won the slot. */
		function claimTaskboardApply() {
			if (globalThis.__dshTaskboardApplied === true) return false;
			globalThis.__dshTaskboardApplied = true;
			return true;
		}
		/**
		* Releases the claim. Called from the client fiber cleanup so that a
		* hot-reloaded bundle (the loader unloads the old plugin fiber and invokes
		* the rebuilt one in the same page) can claim again instead of being
		* silently dropped.
		*/
		function releaseTaskboardApply() {
			globalThis.__dshTaskboardApplied = void 0;
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Task-board copy: zh-first dictionaries with an English fallback, selected
		* by the document language. Kept dependency-free (no dsh locale service) so
		* the DOM-injected entry row and the standalone board tree share one tiny
		* lookup.
		*/
		/** zh dictionary (key-set source of truth). */
		const zh = {
			"entry.label": "任务看板",
			"board.title": "任务看板",
			"board.close": "返回会话",
			"board.new": "新建任务",
			"board.search": "筛选任务…",
			"board.empty": "这个状态还没有任务",
			"board.filterAll": "全部",
			"board.archive": "归档",
			"board.archiveView": "归档 ({count})",
			"board.backToBoard": "返回看板",
			"archive.empty": "没有已归档的任务",
			"board.status": "状态",
			"board.status.backlog": "待规划",
			"board.status.todo": "待办",
			"board.status.running": "进行中",
			"board.status.review": "待验收",
			"board.status.done": "已完成",
			"board.status.failed": "已失败",
			"board.runs": "次执行",
			"board.pending": "正在提交",
			"board.updated": "更新于",
			"board.created": "创建于",
			"board.hostError": "Host 操作失败：{error}",
			"board.retryHost": "重试连接 Host",
			"board.hostMeta": "Host 时区 {timeZone} · revision {revision}",
			"new.title": "标题",
			"new.titlePlaceholder": "一句话描述要做什么",
			"new.description": "描述",
			"new.descriptionPlaceholder": "补充背景、范围与验收（可选）",
			"new.prompt": "执行 Prompt",
			"new.promptPlaceholder": "发给 agent 的完整指令（留空则使用标题）",
			"new.submit": "创建",
			"new.cancel": "取消",
			"new.required": "标题不能为空",
			"detail.title": "任务详情",
			"detail.edit": "编辑",
			"detail.close": "关闭",
			"edit.title": "编辑任务",
			"edit.save": "保存",
			"detail.prompt": "执行 Prompt",
			"detail.description": "描述",
			"detail.execution": "执行记录",
			"detail.noExecution": "尚未执行",
			"detail.run": "执行",
			"detail.rerun": "重新执行",
			"detail.confirm": "验收通过",
			"detail.reject": "打回",
			"detail.reviewHint": "执行已结束，等待验收：通过→已完成（定时卡回待办继续待命），打回→待办",
			"detail.kind": "卡片类型",
			"detail.kind.once": "一次性",
			"detail.kind.recurring": "定时重复",
			"detail.kind.interactive": "交互式（禁定时）",
			"detail.note": "备注",
			"detail.noteHint": "备注随时可补充；标题与 Prompt 在执行后只读",
			"detail.delete": "删除",
			"detail.archive": "归档",
			"detail.restore": "恢复",
			"detail.archivedAt": "已归档 · {time}",
			"detail.viewSession": "查看会话",
			"detail.noSession": "暂无会话",
			"detail.executionStarted": "已启动",
			"detail.executionEnded": "已结束",
			"detail.result.succeeded": "成功",
			"detail.result.failed": "失败",
			"detail.result.cancelled": "已取消",
			"detail.result.interrupted": "被中断",
			"detail.result.running": "进行中",
			"delete.title": "删除任务",
			"delete.confirm": "确定删除「{name}」吗？删除后不可恢复。",
			"delete.ok": "删除",
			"delete.cancel": "取消",
			"status.move.backlog": "移到待规划",
			"status.move.todo": "移到待办",
			"status.move.done": "移到已完成",
			"exec.error.noWorkspace": "没有可用工作区，无法执行任务",
			"exec.error.promptRejected": "Prompt 被拒绝",
			"run.failed": "执行失败：{error}",
			"time.justNow": "刚刚",
			"detail.schedule": "定时运行",
			"detail.schedule.enable": "启用定时执行",
			"detail.schedule.cron": "Cron 表达式",
			"detail.schedule.presets": "预设",
			"detail.schedule.preset.daily9": "每天 09:00",
			"detail.schedule.preset.hourly": "每小时",
			"detail.schedule.preset.tenMin": "每 10 分钟",
			"detail.schedule.preset.weeklyMon9": "每周一 09:00",
			"detail.schedule.nextRun": "下次运行",
			"detail.schedule.lastTriggered": "上次触发",
			"detail.schedule.invalid": "Cron 表达式无效",
			"detail.schedule.notScheduled": "尚未排程",
			"detail.schedule.dueSoon": "即将运行",
			"card.scheduled": "定时",
			"card.kind.recurring": "循环",
			"card.kind.interactive": "交互式",
			"card.recurring.next": "下次 {time}",
			"card.recurring.last": "上次 {time}",
			"new.workspace": "工作区",
			"new.mode": "模式",
			"new.permission": "权限",
			"exec.workspace.recent": "最近使用（默认）",
			"exec.mode.default": "部署默认",
			"exec.mode.defaultSuffix": "（默认）",
			"exec.mode.brokenSuffix": "（不可用）",
			"exec.mode.removed": "（已移除）",
			"exec.permission.default": "会话默认",
			"exec.permission.read-only": "只读",
			"exec.permission.workspace-write": "工作区可写",
			"exec.permission.danger-full-access": "完全访问",
			"detail.executionSettings": "执行设置",
			"exec.hint": "执行时生效：工作区决定执行会话落在哪个工作区；模式决定会话的 agent 预设；权限经 /permission 命令应用到会话。留空则使用运行时默认。",
			"settings.title": "任务看板",
			"settings.description": "控制 Host 任务看板、agent 播报与运行期间的系统空闲睡眠保护。",
			"settings.enabled": "启用任务看板",
			"settings.enabledHint": "关闭后隐藏侧边栏入口与看板视图。",
			"settings.announceToAgent": "向 agent 播报任务看板",
			"settings.announceToAgentHint": "开启：每条 agent 系统提示都会包含本看板的说明；关闭：不播报，agent 仅在用户主动提及时了解看板。",
			"settings.preventIdleSleep": "阻止系统空闲睡眠",
			"settings.preventIdleSleepHint": "默认关闭。开启后，只要存在运行中的 DSH 会话、已启用的定时任务或会话状态尚未确认，Host 就阻止整机因空闲睡眠；屏幕仍可自动关闭。",
			"settings.powerStatus": "平台：{platform}；保护状态：{phase}；运行会话：{running}；已启用计划：{schedules}",
			"settings.powerBoundary": "这可能增加电池消耗。合盖、手动睡眠、休眠、关机、低电量或企业策略不在保证范围内，也不会唤醒已经睡眠的机器。",
			"settings.powerUnknown": "未知",
			"settings.powerError": "最近一次电源保护错误：{error}",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.overridden": "已覆盖",
			"settings.reset": "恢复默认",
			"settings.notExposed": "当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或为 dsh-host-apiproxy 的 WEB_SETTINGS_NAMESPACES 白名单补充本命名空间后重启。",
			"settings.readOnly": "当前部署的设置只读。",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.discard": "放弃",
			"settings.unsaved": "未保存",
			"settings.saveFailed": "部署未接受这些值，已保留供你修改。",
			"settings.invalidNumber": "请输入数字，留空则使用默认值。",
			"detail.line": "主线",
			"detail.linePlaceholder": "如：发布流水线 · R3",
			"detail.lineHint": "同一主线的卡自动归为一组；用「 · 」分隔写成「主线 · 子线」，按前缀即可筛出全部子线。留空 = 未归线。",
			"detail.seq": "节点",
			"detail.seqPlaceholder": "如：H0",
			"detail.seqHint": "主线上这一步的序号，主线视图内按它排序。",
			"board.viewStatus": "状态视图",
			"board.viewLine": "主线视图",
			"board.lineUnassigned": "未归线",
			"board.lineHeader": "{inflight} 在途 · {done}/{total} 完成",
			"board.lineArchived": "归档 {count}",
			"board.lineArchivedHint": "这条主线已归档 {count} 张卡（不计入 已完成/总数）",
			"board.lineEmpty": "没有匹配的卡片"
		};
		/** en dictionary, complete against the zh key set. */
		const en = {
			"entry.label": "Task Board",
			"board.title": "Task Board",
			"board.close": "Back to chat",
			"board.new": "New Task",
			"board.search": "Filter tasks…",
			"board.empty": "No tasks in this column",
			"board.filterAll": "All",
			"board.archive": "Archive",
			"board.archiveView": "Archived ({count})",
			"board.backToBoard": "Back to board",
			"archive.empty": "No archived tasks",
			"board.status": "Status",
			"board.status.backlog": "Backlog",
			"board.status.todo": "To Do",
			"board.status.running": "In Progress",
			"board.status.review": "Review",
			"board.status.done": "Done",
			"board.status.failed": "Failed",
			"board.runs": "runs",
			"board.pending": "Submitting",
			"board.updated": "Updated",
			"board.created": "Created",
			"board.hostError": "Host action failed: {error}",
			"board.retryHost": "Retry Host connection",
			"board.hostMeta": "Host time zone {timeZone} · revision {revision}",
			"new.title": "Title",
			"new.titlePlaceholder": "What should be done, in one line",
			"new.description": "Description",
			"new.descriptionPlaceholder": "Background, scope, acceptance criteria (optional)",
			"new.prompt": "Run Prompt",
			"new.promptPlaceholder": "The full instruction sent to the agent (title is used when blank)",
			"new.submit": "Create",
			"new.cancel": "Cancel",
			"new.required": "Title is required",
			"detail.title": "Task Detail",
			"detail.edit": "Edit",
			"detail.close": "Close",
			"edit.title": "Edit Task",
			"edit.save": "Save",
			"detail.prompt": "Run Prompt",
			"detail.description": "Description",
			"detail.execution": "Execution History",
			"detail.noExecution": "Not executed yet",
			"detail.run": "Run",
			"detail.rerun": "Run Again",
			"detail.confirm": "Accept",
			"detail.reject": "Send back",
			"detail.reviewHint": "The run has ended and is waiting for acceptance: accept → Done (a recurring card returns to To Do), send back → To Do",
			"detail.kind": "Card kind",
			"detail.kind.once": "One-off",
			"detail.kind.recurring": "Recurring",
			"detail.kind.interactive": "Interactive (no schedule)",
			"detail.note": "Note",
			"detail.noteHint": "The note can be edited at any time; title and prompt freeze after the first run",
			"detail.delete": "Delete",
			"detail.archive": "Archive",
			"detail.restore": "Restore",
			"detail.archivedAt": "Archived · {time}",
			"detail.viewSession": "View Session",
			"detail.noSession": "No session",
			"detail.executionStarted": "Started",
			"detail.executionEnded": "Ended",
			"detail.result.succeeded": "Succeeded",
			"detail.result.failed": "Failed",
			"detail.result.cancelled": "Cancelled",
			"detail.result.interrupted": "Interrupted",
			"detail.result.running": "Running",
			"delete.title": "Delete Task",
			"delete.confirm": "Delete \"{name}\"? This cannot be undone.",
			"delete.ok": "Delete",
			"delete.cancel": "Cancel",
			"status.move.backlog": "Move to Backlog",
			"status.move.todo": "Move to To Do",
			"status.move.done": "Move to Done",
			"exec.error.noWorkspace": "No workspace is available to run the task",
			"exec.error.promptRejected": "Prompt rejected",
			"run.failed": "Run failed: {error}",
			"time.justNow": "just now",
			"detail.schedule": "Scheduled Runs",
			"detail.schedule.enable": "Enable scheduled runs",
			"detail.schedule.cron": "Cron expression",
			"detail.schedule.presets": "Presets",
			"detail.schedule.preset.daily9": "Every day 09:00",
			"detail.schedule.preset.hourly": "Every hour",
			"detail.schedule.preset.tenMin": "Every 10 minutes",
			"detail.schedule.preset.weeklyMon9": "Every Monday 09:00",
			"detail.schedule.nextRun": "Next run",
			"detail.schedule.lastTriggered": "Last triggered",
			"detail.schedule.invalid": "Invalid cron expression",
			"detail.schedule.notScheduled": "Not scheduled yet",
			"detail.schedule.dueSoon": "Due soon",
			"card.scheduled": "scheduled",
			"card.kind.recurring": "recurring",
			"card.kind.interactive": "interactive",
			"card.recurring.next": "next {time}",
			"card.recurring.last": "last {time}",
			"new.workspace": "Workspace",
			"new.mode": "Mode",
			"new.permission": "Permission",
			"exec.workspace.recent": "Most recent (default)",
			"exec.mode.default": "Deployment default",
			"exec.mode.defaultSuffix": " (default)",
			"exec.mode.brokenSuffix": " (unavailable)",
			"exec.mode.removed": " (removed)",
			"exec.permission.default": "Session default",
			"exec.permission.read-only": "Read-only",
			"exec.permission.workspace-write": "Workspace Write",
			"exec.permission.danger-full-access": "Full Access",
			"detail.executionSettings": "Execution Settings",
			"exec.hint": "Applied when the task runs: the workspace decides where the execution session lands; the mode composes the session's agent preset; the permission is applied through the /permission command. Blank = runtime default.",
			"settings.title": "Task Board",
			"settings.description": "Configure the Host task board, agent announcement, and idle-system-sleep protection while work is pending.",
			"settings.enabled": "Enable the task board",
			"settings.enabledHint": "When off, the sidebar entry and board view are hidden.",
			"settings.announceToAgent": "Announce the task board to agents",
			"settings.announceToAgentHint": "On: every agent system prompt includes a note about this board. Off: no announcement; agents learn about the board only when you mention it.",
			"settings.preventIdleSleep": "Prevent idle system sleep",
			"settings.preventIdleSleepHint": "Off by default. When enabled, the Host prevents idle system sleep while any DSH session runs, any schedule is enabled, or session state is not yet known. The display may still turn off.",
			"settings.powerStatus": "Platform: {platform}; protection: {phase}; running sessions: {running}; enabled schedules: {schedules}",
			"settings.powerBoundary": "This may use more battery. Lid close, manual sleep, hibernation, shutdown, low-battery actions, and enterprise policy are outside the guarantee; an already sleeping computer is not woken.",
			"settings.powerUnknown": "unknown",
			"settings.powerError": "Latest power-protection error: {error}",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.overridden": "Overridden",
			"settings.reset": "Reset to default",
			"settings.notExposed": "This DSH version does not expose this plugin's settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to dsh-host-apiproxy's WEB_SETTINGS_NAMESPACES allowlist and restart.",
			"settings.readOnly": "This deployment stores settings read-only.",
			"settings.expand": "Show settings",
			"settings.collapse": "Hide settings",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved",
			"settings.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"settings.invalidNumber": "Enter a number, or leave blank to use the default.",
			"detail.line": "Main line",
			"detail.linePlaceholder": "e.g. Release pipeline · R3",
			"detail.lineHint": "Cards sharing a line are grouped together; separate parts with \" · \" to write \"line · sub-line\" so the prefix filters every sub-line. Blank = unassigned.",
			"detail.seq": "Node",
			"detail.seqPlaceholder": "e.g. H0",
			"detail.seqHint": "This step's position inside the line; the line view sorts by it.",
			"board.viewStatus": "Status view",
			"board.viewLine": "Line view",
			"board.lineUnassigned": "Unassigned",
			"board.lineHeader": "{inflight} in flight · {done}/{total} done",
			"board.lineArchived": "Archived {count}",
			"board.lineArchivedHint": "{count} archived card(s) on this line (not counted in done/total)",
			"board.lineEmpty": "No matching cards"
		};
		/** Active dictionary, picked by the document language at call time. */
		function dictionary() {
			return (typeof document !== "undefined" ? document.documentElement.lang : "zh").toLowerCase().startsWith("en") ? en : zh;
		}
		/** Translate a key with optional {name} template params. */
		function t(key, params) {
			let text = dictionary()[key];
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, value);
			return text;
		}
		//#endregion
		//#region \0dsh-css:src/client/board.module.css.mjs
		const css$1 = "[data-pane=conversation],[class*=centerCol]{position:relative}[data-dsh-taskboard-view]{z-index:60;background:var(--dsw-alias-bg-base);display:none;position:absolute;inset:0;container:_1VdgPa_task-board-view/inline-size}html[data-dsh-taskboard-active]:not([data-dsh-ssh-active]) [data-dsh-taskboard-view]{display:block}html[data-dsh-taskboard-active]:not([data-dsh-ssh-active]) [data-pane=conversation]>:not([data-dsh-taskboard-view]),html[data-dsh-taskboard-active]:not([data-dsh-ssh-active]) [class*=centerCol]>:not([data-dsh-taskboard-view]){display:none!important}._1VdgPa_entry{box-sizing:border-box;color:inherit;cursor:pointer;white-space:nowrap;flex:none;justify-content:center;align-items:center;gap:6px;display:inline-flex;overflow:hidden}._1VdgPa_entry[data-active]{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary);font-weight:500}._1VdgPa_entryIcon{flex:none;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex}._1VdgPa_entryIcon svg{width:14px;height:14px;display:block}[data-sidebar-collapsed] ._1VdgPa_entryIcon svg{width:18px;height:18px}._1VdgPa_entryLabel{text-overflow:ellipsis;overflow:hidden}[data-sidebar-collapsed] ._1VdgPa_entry{justify-content:center;align-items:center;display:inline-flex}[data-sidebar-collapsed] ._1VdgPa_entry[data-active]:hover{background:var(--dsw-specific-sidebar-nav-item-active)}[data-sidebar-collapsed] ._1VdgPa_entryLabel{display:none}._1VdgPa_board{box-sizing:border-box;background:var(--dsw-alias-bg-base);min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);flex-direction:column;gap:12px;padding:14px 16px 16px;display:flex}._1VdgPa_boardHeader{flex:none;align-items:center;gap:10px;display:flex}._1VdgPa_boardTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;margin:0;font-size:16px;font-weight:700}._1VdgPa_backButton{align-items:center;gap:4px;display:inline-flex}._1VdgPa_search{min-width:120px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;flex:0 260px;padding:6px 10px;font-size:13px}._1VdgPa_search::placeholder{color:var(--dsw-alias-label-tertiary)}._1VdgPa_columns{overscroll-behavior-inline:contain;scrollbar-color:var(--dsw-alias-border-l3) var(--dsw-alias-interactive-bg-hover);scrollbar-width:thin;flex:1;grid-auto-columns:minmax(180px,1fr);grid-auto-flow:column;gap:12px;min-height:0;padding-bottom:6px;display:grid;overflow:auto hidden}._1VdgPa_columns::-webkit-scrollbar{height:10px}._1VdgPa_columns::-webkit-scrollbar-track{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px}._1VdgPa_columns::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);background-clip:content-box;border:2px solid #0000;border-radius:999px}._1VdgPa_columns::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-border-l4);background-clip:content-box}._1VdgPa_columnsLine{grid-auto-columns:minmax(300px,1fr)}._1VdgPa_column{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;flex-direction:column;min-height:0;display:flex;overflow:hidden}._1VdgPa_columnHeader{flex:none;align-items:center;gap:6px;padding:10px 12px;display:flex}._1VdgPa_columnTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0;font-size:13px;font-weight:700;overflow:hidden}._1VdgPa_columnCount{min-width:0;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;flex:none;padding:1px 8px;font-size:12px}._1VdgPa_columnCountArchived{border:1px dashed var(--dsw-alias-border-l3);background:0 0;flex:none;padding:0 8px}._1VdgPa_statusDot{border-radius:50%;flex:none;width:8px;height:8px}._1VdgPa_statusDot[data-status=backlog]{background:var(--dsw-alias-label-tertiary)}._1VdgPa_statusDot[data-status=todo]{background:var(--dsw-alias-state-business-primary)}._1VdgPa_statusDot[data-status=running]{background:var(--dsw-alias-state-warn-primary)}._1VdgPa_statusDot[data-status=review]{background:var(--dsw-alias-state-business-primary)}._1VdgPa_statusDot[data-status=done]{background:var(--dsw-alias-state-success-primary)}._1VdgPa_statusDot[data-status=failed]{background:var(--dsw-alias-state-error-primary)}._1VdgPa_cards{flex-direction:column;flex:1;gap:8px;min-height:0;padding:2px 8px 10px;display:flex;overflow-y:auto}._1VdgPa_columnEmpty{text-align:center;color:var(--dsw-alias-label-tertiary);padding:24px 8px;font-size:12px}._1VdgPa_card{text-align:left;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;color:var(--dsw-alias-label-primary);border-radius:10px;flex-direction:column;gap:6px;padding:10px 12px;font-family:inherit;transition:box-shadow .12s,border-color .12s,transform .12s;display:flex}._1VdgPa_card:hover{box-shadow:var(--dsw-shadow-lv2);border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}._1VdgPa_card[data-status=running]{border-color:var(--dsw-alias-state-warn-primary)}._1VdgPa_cardTitle{-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;font-weight:600;line-height:1.35;display:-webkit-box;overflow:hidden}._1VdgPa_cardExcerpt{color:var(--dsw-alias-label-secondary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.4;display:-webkit-box;overflow:hidden}._1VdgPa_cardMeta{color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;font-size:11px;display:flex}._1VdgPa_cardTime{text-overflow:ellipsis;white-space:nowrap;flex:1;overflow:hidden}._1VdgPa_cardSchedule{white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;flex:none;padding:2px 6px;font-size:12px;line-height:1}._1VdgPa_cardRun{flex:none}._1VdgPa_cardRun[data-result=failed]{color:var(--dsw-alias-state-error-primary)}._1VdgPa_cardRun[data-result=succeeded]{color:var(--dsw-alias-state-success-primary)}._1VdgPa_cardSession{color:var(--dsw-alias-state-business-primary);flex:none}._1VdgPa_cardRunningLabel{color:var(--dsw-alias-state-warn-primary);font-size:11px}._1VdgPa_cardSpinner{border:2px solid var(--dsw-alias-state-warn-primary);border-top-color:#0000;border-radius:50%;flex:none;width:10px;height:10px;animation:.8s linear infinite _1VdgPa_dshTbSpin}@keyframes _1VdgPa_dshTbSpin{to{transform:rotate(360deg)}}._1VdgPa_primaryButton{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-info-fill);cursor:pointer;white-space:nowrap;border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600}._1VdgPa_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}._1VdgPa_primaryButton:disabled{opacity:.5;cursor:default}._1VdgPa_ghostButton{color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;background:0 0;border-radius:8px;padding:5px 12px;font-size:12px}._1VdgPa_ghostButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._1VdgPa_ghostButton:disabled{opacity:.45;cursor:default}._1VdgPa_dangerButton{color:#fff;background:var(--dsw-alias-state-error-primary);cursor:pointer;white-space:nowrap;border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600}._1VdgPa_dangerButton:hover:not(:disabled){filter:brightness(1.08)}._1VdgPa_dangerButton:active:not(:disabled){filter:brightness(.94)}._1VdgPa_dangerButton:disabled{opacity:.5;cursor:default}._1VdgPa_iconButton{width:26px;height:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;font-size:13px;display:inline-flex}._1VdgPa_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._1VdgPa_linkButton{color:var(--dsw-alias-state-business-primary);cursor:pointer;white-space:nowrap;background:0 0;border:none;padding:0;font-size:12px}._1VdgPa_linkButton:hover{text-decoration:underline}._1VdgPa_modalBackdrop{z-index:1300;background:var(--dsw-alias-bg-mask-1);justify-content:center;align-items:center;display:flex;position:fixed;inset:0}._1VdgPa_modal{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);width:min(520px,100vw - 48px);max-height:calc(100vh - 96px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);border-radius:14px;flex-direction:column;gap:12px;padding:18px;display:flex;overflow-y:auto}._1VdgPa_modalTitle{margin:0;font-size:15px;font-weight:700}._1VdgPa_confirmMessage{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:13px;line-height:1.5}._1VdgPa_modalFooter{justify-content:flex-end;gap:10px;margin-top:4px;display:flex}._1VdgPa_field{flex-direction:column;gap:5px;display:flex}._1VdgPa_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}._1VdgPa_input{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);resize:vertical;border-radius:8px;outline:none;padding:7px 10px;font-family:inherit;font-size:13px}._1VdgPa_input:focus{border-color:var(--dsw-alias-state-business-primary)}._1VdgPa_select{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;max-width:100%;padding:7px 10px;font-family:inherit;font-size:13px}._1VdgPa_input::placeholder{color:var(--dsw-alias-label-tertiary)}._1VdgPa_formError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px}._1VdgPa_detail{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);width:min(640px,100vw - 48px);max-height:calc(100vh - 80px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);border-radius:14px;flex-direction:column;display:flex;overflow:hidden}._1VdgPa_detailHeader{border-bottom:1px solid var(--dsw-alias-separator-primary);flex:none;align-items:center;gap:10px;padding:14px 18px;display:flex}._1VdgPa_detailTitle{overflow-wrap:anywhere;flex:1;margin:0;font-size:15px;font-weight:700}._1VdgPa_statusBadge{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:2px 10px;font-size:12px}._1VdgPa_statusBadge[data-status=running]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}._1VdgPa_statusBadge[data-status=review]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}._1VdgPa_statusBadge[data-status=done]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}._1VdgPa_statusBadge[data-status=failed]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}._1VdgPa_detailBody{flex-direction:column;flex:1;gap:16px;padding:14px 18px;display:flex;overflow-y:auto}._1VdgPa_detailSection{flex-direction:column;gap:6px;display:flex}._1VdgPa_detailSection h4{color:var(--dsw-alias-label-tertiary);text-transform:none;margin:0;font-size:12px;font-weight:700}._1VdgPa_detailText{color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:13px;line-height:1.55}._1VdgPa_reviewGate{border:1px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-base);border-radius:10px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}._1VdgPa_reviewActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}._1VdgPa_reviewActions input{flex:1;min-width:160px}._1VdgPa_cardKind{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;flex:none;padding:1px 6px;font-size:11px}._1VdgPa_cardKind[data-kind=recurring]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}._1VdgPa_cardKind[data-kind=interactive]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}._1VdgPa_cardLine{text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;align-self:flex-start;padding:1px 6px;font-size:11px;line-height:1.4;overflow:hidden}._1VdgPa_scheduleToggle{color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;align-items:center;gap:8px;font-size:13px;display:flex}._1VdgPa_scheduleToggle input{accent-color:var(--dsw-alias-state-business-primary)}._1VdgPa_scheduleRow{align-items:center;gap:8px;display:flex}._1VdgPa_scheduleInput{min-width:0;font-family:var(--dsw-font-markdown-code-block-small);flex:1;font-size:12.5px}._1VdgPa_scheduleInputInvalid,._1VdgPa_scheduleInputInvalid:focus{border-color:var(--dsw-alias-state-error-primary)}._1VdgPa_schedulePreset{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;flex:none;padding:7px 8px;font-size:12.5px}._1VdgPa_scheduleMeta{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:12px}._1VdgPa_promptBlock{font-size:12.5px;line-height:1.5;font-family:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:8px;max-height:240px;margin:0;padding:10px 12px;overflow-y:auto}._1VdgPa_executionList{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}._1VdgPa_executionRow{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 10px;display:flex}._1VdgPa_executionBadge{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:600}._1VdgPa_executionBadge[data-result=succeeded]{color:var(--dsw-alias-state-success-primary);background:0 0}._1VdgPa_executionBadge[data-result=failed]{color:var(--dsw-alias-state-error-primary);background:0 0}._1VdgPa_executionBadge[data-result=cancelled]{color:var(--dsw-alias-label-tertiary);background:0 0}._1VdgPa_executionBadge[data-result=interrupted]{color:var(--dsw-alias-state-warn-primary);background:0 0}._1VdgPa_executionTimes{color:var(--dsw-alias-label-secondary);font-size:12px}._1VdgPa_executionError{width:100%;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;font-size:12px}._1VdgPa_moveRow{flex-wrap:wrap;gap:8px;display:flex}._1VdgPa_detailFooter{border-top:1px solid var(--dsw-alias-separator-primary);flex:none;align-items:center;gap:10px;padding:12px 18px;display:flex}._1VdgPa_detailMeta{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:11px}@media (width<=768px){@container _1VdgPa_task-board-view (width<=768px){._1VdgPa_board{gap:10px;padding:10px}._1VdgPa_boardHeader{flex-wrap:wrap;align-items:center;gap:8px}._1VdgPa_backButton{flex:none;order:1}._1VdgPa_boardTitle{flex:auto;order:2}._1VdgPa_boardHeader>._1VdgPa_detailMeta{flex:1 0 100%;order:3;margin-left:0}._1VdgPa_search{flex:1 0 100%;order:4;min-width:0}._1VdgPa_boardHeader>button:not(._1VdgPa_backButton){flex:1 1 0;order:5;min-width:0}._1VdgPa_columns{scroll-snap-type:inline mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;grid-auto-columns:86cqw;gap:10px;padding-inline:2px 14cqw;scroll-padding-inline:2px}._1VdgPa_columns::-webkit-scrollbar{display:none}._1VdgPa_column{scroll-snap-align:start;scroll-snap-stop:always}}@container _1VdgPa_task-board-view (width<=720px){._1VdgPa_boardHeader>._1VdgPa_detailMeta{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}}@container _1VdgPa_task-board-view (width<=600px){._1VdgPa_board{padding-inline:8px}}[data-dsh-taskboard-view]{height:100dvh}._1VdgPa_entry,._1VdgPa_card,._1VdgPa_primaryButton,._1VdgPa_ghostButton,._1VdgPa_dangerButton,._1VdgPa_iconButton,._1VdgPa_linkButton,._1VdgPa_search,._1VdgPa_input,._1VdgPa_select,._1VdgPa_schedulePreset,._1VdgPa_scheduleToggle{min-height:44px}._1VdgPa_search,._1VdgPa_input,._1VdgPa_select,._1VdgPa_schedulePreset{box-sizing:border-box;font-size:16px}._1VdgPa_modalBackdrop{justify-content:stretch;align-items:stretch;width:100vw;height:100dvh}._1VdgPa_modal,._1VdgPa_detail{box-sizing:border-box;border:0;border-radius:0;width:100vw;height:100dvh;max-height:none}._1VdgPa_modal{padding-top:max(16px, env(safe-area-inset-top));padding-right:max(16px, env(safe-area-inset-right));padding-bottom:max(16px, env(safe-area-inset-bottom));padding-left:max(16px, env(safe-area-inset-left))}._1VdgPa_modalFooter{z-index:1;background:var(--dsw-alias-bg-base);flex-wrap:wrap;padding-top:8px;position:sticky;bottom:0}._1VdgPa_modalFooter>button{flex:120px}._1VdgPa_detailHeader{padding-top:max(12px, env(safe-area-inset-top));padding-right:max(14px, env(safe-area-inset-right));padding-left:max(14px, env(safe-area-inset-left));flex-wrap:wrap}._1VdgPa_detailTitle{min-width:0}._1VdgPa_detailBody{overscroll-behavior-y:contain;padding-right:max(14px, env(safe-area-inset-right));padding-left:max(14px, env(safe-area-inset-left))}._1VdgPa_detailFooter{padding-right:max(14px, env(safe-area-inset-right));padding-bottom:max(12px, env(safe-area-inset-bottom));padding-left:max(14px, env(safe-area-inset-left));flex-wrap:wrap}._1VdgPa_detailFooter>button{flex:96px}._1VdgPa_detailFooter>._1VdgPa_detailMeta{text-align:end;flex:1 0 100%;margin-left:0}._1VdgPa_scheduleRow{flex-direction:column;align-items:stretch}._1VdgPa_schedulePreset{width:100%}}._1VdgPa_entry:focus-visible,._1VdgPa_card:focus-visible,._1VdgPa_primaryButton:focus-visible,._1VdgPa_ghostButton:focus-visible,._1VdgPa_dangerButton:focus-visible,._1VdgPa_iconButton:focus-visible,._1VdgPa_linkButton:focus-visible,._1VdgPa_search:focus-visible,._1VdgPa_input:focus-visible,._1VdgPa_select:focus-visible,._1VdgPa_schedulePreset:focus-visible,._1VdgPa_scheduleToggle input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}._1VdgPa_entry,._1VdgPa_primaryButton,._1VdgPa_ghostButton,._1VdgPa_dangerButton,._1VdgPa_iconButton,._1VdgPa_linkButton,._1VdgPa_search,._1VdgPa_input,._1VdgPa_select,._1VdgPa_schedulePreset,._1VdgPa_scheduleToggle input{transition:background-color .12s,color .12s,border-color .12s,outline-color .12s,box-shadow .12s,transform .12s}._1VdgPa_card:active{box-shadow:var(--dsw-shadow-lv1);transform:translateY(0)}._1VdgPa_entry:active,._1VdgPa_primaryButton:active:not(:disabled),._1VdgPa_ghostButton:active:not(:disabled),._1VdgPa_dangerButton:active:not(:disabled),._1VdgPa_iconButton:active:not(:disabled),._1VdgPa_linkButton:active:not(:disabled){transform:translateY(1px)}._1VdgPa_entry[data-active]:hover{background:var(--dsw-specific-sidebar-nav-item-active)}._1VdgPa_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._1VdgPa_linkButton:hover:not(:disabled){text-decoration:underline}._1VdgPa_iconButton:disabled,._1VdgPa_linkButton:disabled{opacity:.45;cursor:default}._1VdgPa_search:focus,._1VdgPa_select:focus,._1VdgPa_schedulePreset:focus{border-color:var(--dsw-alias-state-business-primary)}._1VdgPa_scheduleToggle input{margin:0}@media (prefers-reduced-motion:reduce){._1VdgPa_entry,._1VdgPa_card,._1VdgPa_primaryButton,._1VdgPa_ghostButton,._1VdgPa_dangerButton,._1VdgPa_iconButton,._1VdgPa_linkButton,._1VdgPa_search,._1VdgPa_input,._1VdgPa_select,._1VdgPa_schedulePreset,._1VdgPa_scheduleToggle input{transition:none}._1VdgPa_cardSpinner{animation:none}}._1VdgPa_cardTop{align-items:center;gap:6px;min-width:0;display:flex}._1VdgPa_cardStatus{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);border-radius:6px;flex:none;padding:1px 6px;font-size:11px;line-height:1.4}._1VdgPa_cardStatus[data-status=todo]{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l3)}._1VdgPa_cardStatus[data-status=running]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}._1VdgPa_cardStatus[data-status=review]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}._1VdgPa_cardStatus[data-status=done]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}._1VdgPa_cardStatus[data-status=failed]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}._1VdgPa_card[data-status=done]{opacity:.62}._1VdgPa_card[data-status=done]:hover{opacity:1}._1VdgPa_card[data-status=backlog]{border-style:dashed}._1VdgPa_card[data-status=review]{border-color:var(--dsw-alias-state-business-primary)}";
		const tagId$1 = "@kira905/dsh-task-board-local/src/client/board.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@kira905/dsh-task-board-local";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var board_module_css_default = {
			"backButton": "_1VdgPa_backButton",
			"board": "_1VdgPa_board",
			"boardHeader": "_1VdgPa_boardHeader",
			"boardTitle": "_1VdgPa_boardTitle",
			"card": "_1VdgPa_card",
			"cardExcerpt": "_1VdgPa_cardExcerpt",
			"cardKind": "_1VdgPa_cardKind",
			"cardLine": "_1VdgPa_cardLine",
			"cardMeta": "_1VdgPa_cardMeta",
			"cardRun": "_1VdgPa_cardRun",
			"cardRunningLabel": "_1VdgPa_cardRunningLabel",
			"cardSchedule": "_1VdgPa_cardSchedule",
			"cardSession": "_1VdgPa_cardSession",
			"cardSpinner": "_1VdgPa_cardSpinner",
			"cardStatus": "_1VdgPa_cardStatus",
			"cardTime": "_1VdgPa_cardTime",
			"cardTitle": "_1VdgPa_cardTitle",
			"cardTop": "_1VdgPa_cardTop",
			"cards": "_1VdgPa_cards",
			"column": "_1VdgPa_column",
			"columnCount": "_1VdgPa_columnCount",
			"columnCountArchived": "_1VdgPa_columnCountArchived",
			"columnEmpty": "_1VdgPa_columnEmpty",
			"columnHeader": "_1VdgPa_columnHeader",
			"columnTitle": "_1VdgPa_columnTitle",
			"columns": "_1VdgPa_columns",
			"columnsLine": "_1VdgPa_columnsLine",
			"confirmMessage": "_1VdgPa_confirmMessage",
			"dangerButton": "_1VdgPa_dangerButton",
			"detail": "_1VdgPa_detail",
			"detailBody": "_1VdgPa_detailBody",
			"detailFooter": "_1VdgPa_detailFooter",
			"detailHeader": "_1VdgPa_detailHeader",
			"detailMeta": "_1VdgPa_detailMeta",
			"detailSection": "_1VdgPa_detailSection",
			"detailText": "_1VdgPa_detailText",
			"detailTitle": "_1VdgPa_detailTitle",
			"dshTbSpin": "_1VdgPa_dshTbSpin",
			"entry": "_1VdgPa_entry",
			"entryIcon": "_1VdgPa_entryIcon",
			"entryLabel": "_1VdgPa_entryLabel",
			"executionBadge": "_1VdgPa_executionBadge",
			"executionError": "_1VdgPa_executionError",
			"executionList": "_1VdgPa_executionList",
			"executionRow": "_1VdgPa_executionRow",
			"executionTimes": "_1VdgPa_executionTimes",
			"field": "_1VdgPa_field",
			"fieldLabel": "_1VdgPa_fieldLabel",
			"formError": "_1VdgPa_formError",
			"ghostButton": "_1VdgPa_ghostButton",
			"iconButton": "_1VdgPa_iconButton",
			"input": "_1VdgPa_input",
			"linkButton": "_1VdgPa_linkButton",
			"modal": "_1VdgPa_modal",
			"modalBackdrop": "_1VdgPa_modalBackdrop",
			"modalFooter": "_1VdgPa_modalFooter",
			"modalTitle": "_1VdgPa_modalTitle",
			"moveRow": "_1VdgPa_moveRow",
			"primaryButton": "_1VdgPa_primaryButton",
			"promptBlock": "_1VdgPa_promptBlock",
			"reviewActions": "_1VdgPa_reviewActions",
			"reviewGate": "_1VdgPa_reviewGate",
			"scheduleInput": "_1VdgPa_scheduleInput",
			"scheduleInputInvalid": "_1VdgPa_scheduleInputInvalid",
			"scheduleMeta": "_1VdgPa_scheduleMeta",
			"schedulePreset": "_1VdgPa_schedulePreset",
			"scheduleRow": "_1VdgPa_scheduleRow",
			"scheduleToggle": "_1VdgPa_scheduleToggle",
			"search": "_1VdgPa_search",
			"select": "_1VdgPa_select",
			"statusBadge": "_1VdgPa_statusBadge",
			"statusDot": "_1VdgPa_statusDot",
			"task-board-view": "_1VdgPa_task-board-view"
		};
		//#endregion
		//#region src/client/schedule-presets.ts
		/** Common scheduled-run presets (cron → locale label). */
		const SCHEDULE_PRESETS = [
			{
				cron: "0 9 * * *",
				label: "detail.schedule.preset.daily9"
			},
			{
				cron: "0 * * * *",
				label: "detail.schedule.preset.hourly"
			},
			{
				cron: "*/10 * * * *",
				label: "detail.schedule.preset.tenMin"
			},
			{
				cron: "0 9 * * 1",
				label: "detail.schedule.preset.weeklyMon9"
			}
		];
		//#endregion
		//#region src/client/board/NewTaskModal.tsx
		/**
		* New-task modal: title + description + the prompt that execution will send.
		* Creates through the Host and closes only after the Host confirms it.
		*/
		/** New-task form overlay. */
		function NewTaskModal({ controller, onClose }) {
			const [title, setTitle] = (0, react.useState)("");
			const [line, setLine] = (0, react.useState)("");
			const [seq, setSeq] = (0, react.useState)("");
			const [description, setDescription] = (0, react.useState)("");
			const [prompt, setPrompt] = (0, react.useState)("");
			const [workspaceId, setWorkspaceId] = (0, react.useState)("");
			const [mode, setMode] = (0, react.useState)("");
			const [permission, setPermission] = (0, react.useState)("");
			const [kind, setKind] = (0, react.useState)("once");
			const [scheduleEnabled, setScheduleEnabled] = (0, react.useState)(false);
			const [scheduleCron, setScheduleCron] = (0, react.useState)("");
			const [scheduleError, setScheduleError] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [pending, setPending] = (0, react.useState)(false);
			const [options, setOptions] = (0, react.useState)(controller.getSnapshot().executionOptions);
			(0, react.useEffect)(() => controller.subscribe(() => setOptions(controller.getSnapshot().executionOptions)), [controller]);
			const submit = async () => {
				if (scheduleEnabled) {
					const cron = scheduleCron.trim();
					if (cron === "" || !isValidCron(cron)) {
						setScheduleError(t("detail.schedule.invalid"));
						return;
					}
				}
				setPending(true);
				if (await controller.createTaskConfirmed({
					title,
					description,
					prompt,
					workspaceId: workspaceId === "" ? void 0 : workspaceId,
					mode: mode === "" ? void 0 : mode,
					permission: permission === "" ? void 0 : permission,
					kind,
					line: line.trim() === "" ? void 0 : line,
					seq: seq.trim() === "" ? void 0 : seq,
					schedule: scheduleEnabled ? {
						enabled: true,
						cron: scheduleCron.trim()
					} : void 0
				}) === void 0) {
					setPending(false);
					setError(controller.getSnapshot().transportError ?? t("new.required"));
					return;
				}
				onClose();
			};
			/** Next-run preview for a valid armed cron (creation-time only). */
			const scheduleNextRun = scheduleEnabled && scheduleCron.trim() !== "" && isValidCron(scheduleCron) ? nextRunAtMs(scheduleCron, Date.now()) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: board_module_css_default.modalBackdrop,
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) onClose();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					className: board_module_css_default.modal,
					role: "dialog",
					"aria-label": t("board.new"),
					onSubmit: (event) => {
						event.preventDefault();
						submit();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: board_module_css_default.modalTitle,
							children: t("board.new")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: board_module_css_default.input,
								value: title,
								autoFocus: true,
								placeholder: t("new.titlePlaceholder"),
								onChange: (event) => {
									setTitle(event.target.value);
									setError(void 0);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: board_module_css_default.fieldLabel,
									children: t("detail.line")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: board_module_css_default.input,
									value: line,
									list: "dsh-task-board-lines",
									placeholder: t("detail.linePlaceholder"),
									onChange: (event) => {
										setLine(event.target.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
									id: "dsh-task-board-lines",
									children: collectLines(controller.getSnapshot().tasks).map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: name }, name))
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("detail.seq")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: board_module_css_default.input,
								value: seq,
								placeholder: t("detail.seqPlaceholder"),
								onChange: (event) => {
									setSeq(event.target.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.description")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: board_module_css_default.input,
								rows: 3,
								value: description,
								placeholder: t("new.descriptionPlaceholder"),
								onChange: (event) => {
									setDescription(event.target.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.prompt")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: board_module_css_default.input,
								rows: 4,
								value: prompt,
								placeholder: t("new.promptPlaceholder"),
								onChange: (event) => {
									setPrompt(event.target.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.workspace")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: board_module_css_default.select,
								value: workspaceId,
								onChange: (event) => {
									setWorkspaceId(event.target.value);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("exec.workspace.recent")
								}), options.workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: workspace.workspaceId,
									children: workspace.title
								}, workspace.workspaceId))]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.mode")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: board_module_css_default.select,
								value: mode,
								onChange: (event) => {
									setMode(event.target.value);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("exec.mode.default")
								}), options.presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: preset.id,
									disabled: preset.broken !== void 0,
									children: [
										preset.name ?? preset.id,
										preset.isDefault ? t("exec.mode.defaultSuffix") : "",
										preset.broken !== void 0 ? t("exec.mode.brokenSuffix") : ""
									]
								}, preset.id))]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.permission")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: board_module_css_default.select,
								value: permission,
								onChange: (event) => {
									setPermission(event.target.value);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("exec.permission.default")
								}), TASK_PERMISSIONS.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: id,
									children: t(`exec.permission.${id}`)
								}, id))]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("detail.kind")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: board_module_css_default.select,
								value: kind,
								onChange: (event) => {
									const next = event.target.value;
									setKind(next);
									if (next === "interactive") {
										setScheduleEnabled(false);
										setScheduleError(void 0);
									}
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "once",
										children: t("detail.kind.once")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "recurring",
										children: t("detail.kind.recurring")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "interactive",
										children: t("detail.kind.interactive")
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: board_module_css_default.detailSection,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.schedule") }), kind === "interactive" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: board_module_css_default.detailText,
								children: t("detail.kind.interactive")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: board_module_css_default.scheduleToggle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: scheduleEnabled,
									onChange: (event) => {
										setScheduleEnabled(event.target.checked);
										if (!event.target.checked) setScheduleError(void 0);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("detail.schedule.enable") })]
							}), scheduleEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: board_module_css_default.scheduleRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: `${board_module_css_default.input} ${board_module_css_default.scheduleInput}${scheduleError !== void 0 ? ` ${board_module_css_default.scheduleInputInvalid}` : ""}`,
										value: scheduleCron,
										placeholder: "0 9 * * *",
										spellCheck: false,
										"aria-label": t("detail.schedule.cron"),
										onChange: (event) => {
											setScheduleCron(event.target.value);
											setScheduleError(void 0);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: board_module_css_default.schedulePreset,
										value: "",
										"aria-label": t("detail.schedule.presets"),
										onChange: (event) => {
											if (event.target.value === "") return;
											setScheduleCron(event.target.value);
											setScheduleError(void 0);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: "",
											children: [t("detail.schedule.presets"), "…"]
										}), SCHEDULE_PRESETS.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: preset.cron,
											children: t(preset.label)
										}, preset.cron))]
									})]
								}),
								scheduleError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: board_module_css_default.formError,
									children: scheduleError
								}),
								scheduleError === void 0 && scheduleNextRun !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: board_module_css_default.scheduleMeta,
									children: [
										t("detail.schedule.nextRun"),
										" ",
										new Date(scheduleNextRun).toLocaleString()
									]
								})
							] })] })]
						}),
						error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: board_module_css_default.formError,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							className: board_module_css_default.modalFooter,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: board_module_css_default.ghostButton,
								onClick: onClose,
								children: t("new.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: board_module_css_default.primaryButton,
								disabled: pending,
								children: t("new.submit")
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/board/status-key.ts
		/** Task status → locale key (board column titles and the detail badge). */
		const STATUS_KEY = {
			backlog: "board.status.backlog",
			todo: "board.status.todo",
			running: "board.status.running",
			review: "board.status.review",
			done: "board.status.done",
			failed: "board.status.failed"
		};
		//#endregion
		//#region src/client/board/TaskCard.tsx
		/**
		* Task card: the board's column item. Clicking opens the task detail — it
		* never executes anything directly (detail holds the Run button).
		*
		* Memoized: the card re-renders only when its own task record changes, so a
		* status/filter update on one card (or scrolling) never re-renders every
		* card on the board. The per-card onClick is built with a stable task reference
		* by the board, so the memo boundary is effective.
		*/
		/** Compact relative/absolute time label. */
		function formatHostTimestamp(ms, timeZone) {
			try {
				return new Intl.DateTimeFormat(void 0, {
					dateStyle: "medium",
					timeStyle: "medium",
					...timeZone === void 0 ? {} : { timeZone }
				}).format(new Date(ms));
			} catch {
				return new Date(ms).toISOString();
			}
		}
		function formatTime(ms, timeZone) {
			const date = new Date(ms);
			const minutes = Math.floor((Date.now() - ms) / 6e4);
			if (minutes < 1) return t("time.justNow");
			if (minutes < 60) return `${minutes}m`;
			if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
			if (timeZone !== void 0) return formatHostTimestamp(ms, timeZone);
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}
		/** One card in a column. */
		function TaskCardInner({ task, pending, timeZone, showStatus, onClick }) {
			const latest = task.executions[task.executions.length - 1];
			const runs = task.executions.length;
			const archived = task.archivedAt !== void 0;
			const statusBadge = showStatus === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: board_module_css_default.cardStatus,
				"data-status": archived ? "archived" : task.status,
				"data-dsh-part": "card-status",
				children: t(STATUS_KEY[task.status])
			}) : null;
			const lineBadge = task.line === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: board_module_css_default.cardLine,
				title: `${t("detail.line")}: ${task.line}`,
				children: task.seq === void 0 ? task.line : `${task.seq} · ${task.line}`
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: board_module_css_default.card,
				"data-status": archived ? "archived" : task.status,
				"data-dsh-part": "card",
				"data-pending": pending || void 0,
				onClick,
				title: task.description !== "" ? task.description : task.title,
				children: [
					statusBadge === null ? lineBadge : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: board_module_css_default.cardTop,
						children: [statusBadge, lineBadge]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: board_module_css_default.cardTitle,
						children: task.title
					}),
					task.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: board_module_css_default.cardExcerpt,
						children: task.description
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: board_module_css_default.cardMeta,
						children: [
							!archived && taskKind(task) !== "once" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.cardKind,
								"data-kind": taskKind(task),
								children: t(isInteractiveTask(task) ? "card.kind.interactive" : "card.kind.recurring")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: board_module_css_default.cardTime,
								children: [
									t("board.updated"),
									" ",
									formatTime(task.updatedAt)
								]
							}),
							!archived && task.schedule?.enabled === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.cardSchedule,
								title: task.schedule.nextRunAt !== void 0 ? `${t("card.scheduled")} · ${formatHostTimestamp(task.schedule.nextRunAt, timeZone)}` : t("card.scheduled"),
								children: task.schedule.nextRunAt !== void 0 ? t("card.recurring.next", { time: formatHostTimestamp(task.schedule.nextRunAt, timeZone) }) : t("card.scheduled")
							}),
							!archived && isRecurringTask(task) && task.schedule?.lastTriggeredAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.cardTime,
								children: t("card.recurring.last", { time: formatTime(task.schedule.lastTriggeredAt, timeZone) })
							}),
							latest !== void 0 && (isRecurringTask(task) || runs > 1) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: board_module_css_default.cardRun,
								"data-result": archived ? void 0 : latest.result,
								children: [
									runs,
									" ",
									t("board.runs")
								]
							}),
							latest?.sessionId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.cardSession,
								title: latest.sessionId,
								children: "⌁"
							}),
							!archived && (task.status === "running" || pending) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.cardSpinner,
								"aria-hidden": "true"
							})
						]
					}),
					!archived && pending && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: board_module_css_default.cardRunningLabel,
						children: [t("board.pending"), "…"]
					}),
					!archived && latest !== void 0 && executionLabel(latest) === "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: board_module_css_default.cardRunningLabel,
						children: [t("detail.result.running"), "…"]
					})
				]
			});
		}
		/** Memoized card: re-renders only when the card's own task record changes. */
		const TaskCard = (0, react.memo)(TaskCardInner);
		//#endregion
		//#region src/client/board/ConfirmDialog.tsx
		/**
		* Generic confirm dialog used by destructive actions (task delete).
		*/
		/** Small confirm overlay. */
		function ConfirmDialog({ title, message, confirmLabel, danger, onCancel, onConfirm }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: board_module_css_default.modalBackdrop,
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: board_module_css_default.modal,
					role: "alertdialog",
					"aria-label": title,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: board_module_css_default.modalTitle,
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: board_module_css_default.confirmMessage,
							children: message
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							className: board_module_css_default.modalFooter,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: board_module_css_default.ghostButton,
								onClick: onCancel,
								children: t("delete.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: danger ? board_module_css_default.dangerButton : board_module_css_default.primaryButton,
								onClick: onConfirm,
								children: confirmLabel
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/board/EditTaskModal.tsx
		/**
		* Edit-task modal. The description doubles as the human note field and is
		* always editable; title and prompt freeze once the task has started
		* executing because they are the record of what actually ran (local fork).
		* The Host re-checks at submit, so a task that started running while the
		* modal was open fails closed and the error surfaces here.
		*/
		/** Edit-task form overlay. */
		function EditTaskModal({ controller, task, onClose }) {
			const identityEditable = canEditTaskIdentity(task);
			const [title, setTitle] = (0, react.useState)(task.title);
			const [description, setDescription] = (0, react.useState)(task.description);
			const [prompt, setPrompt] = (0, react.useState)(task.prompt);
			const [error, setError] = (0, react.useState)(void 0);
			const [pending, setPending] = (0, react.useState)(false);
			const submit = async () => {
				if (identityEditable && title.trim() === "") {
					setError(t("new.required"));
					return;
				}
				setPending(true);
				const patch = identityEditable ? {
					title,
					description,
					prompt
				} : { description };
				if (await controller.updateTask(task.id, patch)) {
					onClose();
					return;
				}
				setPending(false);
				setError(controller.getSnapshot().transportError ?? t("new.required"));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: board_module_css_default.modalBackdrop,
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) onClose();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					className: board_module_css_default.modal,
					role: "dialog",
					"aria-label": t("edit.title"),
					onSubmit: (event) => {
						event.preventDefault();
						submit();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: board_module_css_default.modalTitle,
							children: t("edit.title")
						}),
						!identityEditable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: board_module_css_default.detailText,
							children: t("detail.noteHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: board_module_css_default.input,
								value: title,
								autoFocus: true,
								disabled: !identityEditable,
								placeholder: t("new.titlePlaceholder"),
								onChange: (event) => {
									setTitle(event.target.value);
									setError(void 0);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.description")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: board_module_css_default.input,
								rows: 3,
								value: description,
								placeholder: t("new.descriptionPlaceholder"),
								onChange: (event) => {
									setDescription(event.target.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: board_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("new.prompt")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: board_module_css_default.input,
								rows: 4,
								value: prompt,
								disabled: !identityEditable,
								placeholder: t("new.promptPlaceholder"),
								onChange: (event) => {
									setPrompt(event.target.value);
								}
							})]
						}),
						error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: board_module_css_default.formError,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							className: board_module_css_default.modalFooter,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: board_module_css_default.ghostButton,
								onClick: onClose,
								children: t("new.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: board_module_css_default.primaryButton,
								disabled: pending,
								children: t("edit.save")
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/board/TaskDetail.tsx
		/**
		* Task detail: the full view of one task — content, prompt, execution
		* history — and the only place execution can be triggered. Also offers
		* delete (with confirmation), manual status moves, and a jump to the
		* execution's session transcript.
		*/
		/** Execution outcome → locale key. */
		const RESULT_KEY = {
			succeeded: "detail.result.succeeded",
			failed: "detail.result.failed",
			cancelled: "detail.result.cancelled",
			interrupted: "detail.result.interrupted"
		};
		/** One execution-history row. */
		function ExecutionRow({ execution, timeZone, onOpen }) {
			const result = execution.result;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: board_module_css_default.executionRow,
				"data-result": result,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: board_module_css_default.executionBadge,
						"data-result": result,
						children: result === void 0 ? t("detail.result.running") : t(RESULT_KEY[result])
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: board_module_css_default.executionTimes,
						children: [
							t("detail.executionStarted"),
							" ",
							formatTime(execution.startedAt, timeZone),
							execution.endedAt !== void 0 && ` · ${t("detail.executionEnded")} ${formatTime(execution.endedAt, timeZone)}`
						]
					}),
					execution.sessionId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: board_module_css_default.linkButton,
						onClick: () => {
							onOpen(execution.sessionId);
						},
						title: execution.sessionId,
						children: [t("detail.viewSession"), " ⌁"]
					}),
					execution.error !== void 0 && execution.error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: board_module_css_default.executionError,
						children: execution.error
					})
				]
			});
		}
		/**
		* The card-kind editor (local fork): once / recurring / interactive. An
		* interactive card refuses a schedule in the Host, so switching to it also
		* hides the schedule editor below.
		*/
		function KindSection({ controller, task, pending }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: board_module_css_default.detailSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.kind") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					className: board_module_css_default.select,
					value: taskKind(task),
					disabled: pending,
					onChange: (event) => {
						controller.updateTask(task.id, { kind: event.target.value });
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "once",
							children: t("detail.kind.once")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "recurring",
							children: t("detail.kind.recurring")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "interactive",
							children: t("detail.kind.interactive")
						})
					]
				})]
			});
		}
		/**
		* The main-line editor: which line (主线) the card is filed under and its node
		* position inside that line. Both are free-form assignment labels — editable on
		* any on-board card, like the note — and they drive the board's line view.
		* Text is committed on blur/Enter instead of on every keystroke: each commit is
		* one Host round-trip, and a per-character RPC would flood the ledger revision.
		*/
		function LineSection({ controller, task, pending }) {
			const [line, setLine] = (0, react.useState)(task.line ?? "");
			const [seq, setSeq] = (0, react.useState)(task.seq ?? "");
			(0, react.useEffect)(() => {
				setLine(task.line ?? "");
			}, [task.id, task.line]);
			(0, react.useEffect)(() => {
				setSeq(task.seq ?? "");
			}, [task.id, task.seq]);
			/** Commit one label; an empty value clears the assignment. */
			const save = (field, value) => {
				const trimmed = value.trim();
				if (field === "line") setLine(trimmed);
				else setSeq(trimmed);
				if (trimmed === (field === "line" ? task.line ?? "" : task.seq ?? "")) return;
				controller.updateTask(task.id, field === "line" ? { line: trimmed } : { seq: trimmed });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: board_module_css_default.detailSection,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.line") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: board_module_css_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.fieldLabel,
								children: t("detail.line")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: board_module_css_default.input,
								value: line,
								list: "dsh-task-board-lines",
								disabled: pending,
								placeholder: t("detail.linePlaceholder"),
								onChange: (event) => {
									setLine(event.target.value);
								},
								onBlur: (event) => {
									save("line", event.target.value);
								},
								onKeyDown: (event) => {
									if (event.key === "Enter") event.currentTarget.blur();
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
								id: "dsh-task-board-lines",
								children: collectLines(controller.getSnapshot().tasks).map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: name }, name))
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: board_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: board_module_css_default.fieldLabel,
							children: t("detail.seq")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: board_module_css_default.input,
							value: seq,
							disabled: pending,
							placeholder: t("detail.seqPlaceholder"),
							onChange: (event) => {
								setSeq(event.target.value);
							},
							onBlur: (event) => {
								save("seq", event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") event.currentTarget.blur();
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: board_module_css_default.detailText,
						children: t("detail.lineHint")
					})
				]
			});
		}
		/** The execution-target editor: workspace / mode / permission pickers. */
		function ExecutionSettingsSection({ controller, task, pending }) {
			const [options, setOptions] = (0, react.useState)(controller.getSnapshot().executionOptions);
			(0, react.useEffect)(() => controller.subscribe(() => setOptions(controller.getSnapshot().executionOptions)), [controller]);
			const workspaceId = task.workspaceId ?? "";
			const mode = task.mode ?? "";
			const permission = task.permission ?? "";
			const workspaceKnown = workspaceId === "" || options.workspaces.some((item) => item.workspaceId === workspaceId);
			const modeKnown = mode === "" || options.presets.some((item) => item.id === mode);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: board_module_css_default.detailSection,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.executionSettings") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: board_module_css_default.detailText,
						children: t("exec.hint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: board_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: board_module_css_default.fieldLabel,
							children: t("new.workspace")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: board_module_css_default.select,
							value: workspaceId,
							disabled: pending,
							onChange: (event) => {
								controller.updateTask(task.id, { workspaceId: event.target.value });
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("exec.workspace.recent")
								}),
								!workspaceKnown && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: workspaceId,
									children: [workspaceId, t("exec.mode.removed")]
								}),
								options.workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: workspace.workspaceId,
									children: workspace.title
								}, workspace.workspaceId))
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: board_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: board_module_css_default.fieldLabel,
							children: t("new.mode")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: board_module_css_default.select,
							value: mode,
							disabled: pending,
							onChange: (event) => {
								controller.updateTask(task.id, { mode: event.target.value });
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("exec.mode.default")
								}),
								!modeKnown && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: mode,
									children: [mode, t("exec.mode.removed")]
								}),
								options.presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: preset.id,
									disabled: preset.broken !== void 0,
									children: [
										preset.name ?? preset.id,
										preset.isDefault ? t("exec.mode.defaultSuffix") : "",
										preset.broken !== void 0 ? t("exec.mode.brokenSuffix") : ""
									]
								}, preset.id))
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: board_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: board_module_css_default.fieldLabel,
							children: t("new.permission")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: board_module_css_default.select,
							value: permission,
							disabled: pending,
							onChange: (event) => {
								controller.updateTask(task.id, { permission: event.target.value === "" ? void 0 : event.target.value });
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: t("exec.permission.default")
							}), TASK_PERMISSIONS.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: id,
								children: t(`exec.permission.${id}`)
							}, id))]
						})]
					})
				]
			});
		}
		/** The scheduled-runs editor: enable toggle, cron input + presets, next-run info. */
		function ScheduleSection({ controller, task, pending }) {
			const schedule = task.schedule;
			const [cron, setCron] = (0, react.useState)(schedule?.cron ?? "0 9 * * *");
			const [enabled, setEnabled] = (0, react.useState)(schedule?.enabled ?? false);
			const [nextRunAt, setNextRunAt] = (0, react.useState)(schedule?.nextRunAt);
			const [lastTriggeredAt, setLastTriggeredAt] = (0, react.useState)(schedule?.lastTriggeredAt);
			const [error, setError] = (0, react.useState)(void 0);
			const timeZone = controller.getSnapshot().host?.scheduler.timeZone;
			(0, react.useEffect)(() => {
				setCron(schedule?.cron ?? "0 9 * * *");
				setEnabled(schedule?.enabled ?? false);
				setNextRunAt(schedule?.nextRunAt);
				setLastTriggeredAt(schedule?.lastTriggeredAt);
				setError(void 0);
			}, [
				task.id,
				schedule?.enabled,
				schedule?.cron,
				schedule?.nextRunAt,
				schedule?.lastTriggeredAt
			]);
			/** Validate + persist the current cron text (Enter or blur). */
			const saveCron = (value) => {
				const trimmed = value.trim();
				setCron(trimmed);
				if (trimmed === "" || !isValidCron(trimmed)) {
					setError(t("detail.schedule.invalid"));
					return;
				}
				setError(void 0);
				controller.setSchedule(task.id, { cron: trimmed });
			};
			/** Arm/disarm the schedule (arming first persists the edited cron). */
			const toggleEnabled = (next) => {
				const trimmed = cron.trim();
				if (next && (trimmed === "" || !isValidCron(trimmed))) {
					setError(t("detail.schedule.invalid"));
					return;
				}
				setError(void 0);
				if (controller.setSchedule(task.id, {
					enabled: next,
					...next && trimmed !== schedule?.cron ? { cron: trimmed } : {}
				}) && !controller.isHostBacked()) setEnabled(next);
			};
			const applyPreset = (preset) => {
				if (preset === "") return;
				setCron(preset);
				setError(void 0);
				controller.setSchedule(task.id, { cron: preset });
			};
			const nextLabel = !enabled || nextRunAt === void 0 ? t("detail.schedule.notScheduled") : nextRunAt <= Date.now() ? t("detail.schedule.dueSoon") : formatHostTimestamp(nextRunAt, timeZone);
			const lastLabel = lastTriggeredAt === void 0 ? "—" : formatHostTimestamp(lastTriggeredAt, timeZone);
			if (isInteractiveTask(task)) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: board_module_css_default.detailSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.schedule") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: board_module_css_default.detailText,
					children: t("detail.kind.interactive")
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: board_module_css_default.detailSection,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.schedule") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: board_module_css_default.scheduleToggle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: enabled,
							disabled: pending,
							onChange: (event) => {
								toggleEnabled(event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("detail.schedule.enable") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: board_module_css_default.scheduleRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: `${board_module_css_default.input} ${board_module_css_default.scheduleInput}${error !== void 0 ? ` ${board_module_css_default.scheduleInputInvalid}` : ""}`,
							value: cron,
							disabled: pending,
							placeholder: "0 9 * * *",
							spellCheck: false,
							"aria-label": t("detail.schedule.cron"),
							onChange: (event) => {
								setCron(event.target.value);
								setError(void 0);
							},
							onBlur: () => {
								saveCron(cron);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") saveCron(cron);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: board_module_css_default.schedulePreset,
							value: "",
							disabled: pending,
							"aria-label": t("detail.schedule.presets"),
							onChange: (event) => {
								applyPreset(event.target.value);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: "",
								children: [t("detail.schedule.presets"), "…"]
							}), SCHEDULE_PRESETS.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: preset.cron,
								children: t(preset.label)
							}, preset.cron))]
						})]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: board_module_css_default.formError,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: board_module_css_default.scheduleMeta,
						children: [
							t("detail.schedule.nextRun"),
							" ",
							nextLabel,
							" · ",
							t("detail.schedule.lastTriggered"),
							" ",
							lastLabel
						]
					})
				]
			});
		}
		/** Task detail overlay. */
		function TaskDetail({ controller, task }) {
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			const [showEdit, setShowEdit] = (0, react.useState)(false);
			const [rejectNote, setRejectNote] = (0, react.useState)("");
			const [latest, setLatest] = (0, react.useState)(task);
			(0, react.useEffect)(() => {
				setLatest(task);
			}, [task]);
			(0, react.useEffect)(() => {
				setShowEdit(false);
			}, [task.id]);
			const current = latest;
			const snapshot = controller.getSnapshot();
			const running = current.status === "running";
			const archived = current.archivedAt !== void 0;
			const pending = snapshot.pendingTaskIds.includes(current.id);
			const transportError = snapshot.transportError;
			const timeZone = snapshot.host?.scheduler.timeZone;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: board_module_css_default.modalBackdrop,
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) controller.closeTask();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: board_module_css_default.detail,
						role: "dialog",
						"aria-label": t("detail.title"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: board_module_css_default.detailHeader,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										className: board_module_css_default.detailTitle,
										children: current.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: board_module_css_default.statusBadge,
										"data-status": archived ? "archived" : current.status,
										children: archived ? t("board.archive") : t(STATUS_KEY[current.status])
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: board_module_css_default.iconButton,
										"aria-label": t("detail.close"),
										onClick: () => {
											controller.closeTask();
										},
										children: "×"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: board_module_css_default.detailBody,
								children: [
									transportError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: board_module_css_default.formError,
										children: [
											t("board.hostError", { error: transportError }),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: board_module_css_default.linkButton,
												onClick: () => {
													controller.retryHostSync();
												},
												children: t("board.retryHost")
											})
										]
									}),
									!archived && current.status === "review" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: board_module_css_default.reviewGate,
										"data-dsh-part": "review-gate",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: board_module_css_default.detailText,
											children: t("detail.reviewHint")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: board_module_css_default.reviewActions,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: board_module_css_default.primaryButton,
													disabled: pending,
													onClick: () => {
														controller.confirmTask(current.id);
													},
													children: t("detail.confirm")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: board_module_css_default.input,
													value: rejectNote,
													disabled: pending,
													placeholder: t("detail.note"),
													onChange: (event) => {
														setRejectNote(event.target.value);
													}
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: board_module_css_default.ghostButton,
													disabled: pending,
													onClick: () => {
														controller.rejectTask(current.id, rejectNote).then(() => {
															setRejectNote("");
														});
													},
													children: t("detail.reject")
												})
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: board_module_css_default.detailSection,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.description") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: board_module_css_default.detailText,
											children: current.description !== "" ? current.description : "—"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: board_module_css_default.detailSection,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.prompt") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
											className: board_module_css_default.promptBlock,
											children: current.prompt !== "" ? current.prompt : current.title
										})]
									}),
									!archived && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LineSection, {
											controller,
											task: current,
											pending
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindSection, {
											controller,
											task: current,
											pending
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExecutionSettingsSection, {
											controller,
											task: current,
											pending
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScheduleSection, {
											controller,
											task: current,
											pending
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: board_module_css_default.detailSection,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("detail.execution") }), current.executions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: board_module_css_default.detailText,
											children: t("detail.noExecution")
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
											className: board_module_css_default.executionList,
											children: [...current.executions].reverse().map((execution) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExecutionRow, {
												execution,
												timeZone,
												onOpen: (sessionId) => {
													controller.openSession(sessionId);
												}
											}, execution.id))
										})]
									}),
									!archived && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: board_module_css_default.detailSection,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("board.status") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: board_module_css_default.moveRow,
											children: MANUAL_STATUSES.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: board_module_css_default.ghostButton,
												disabled: current.status === status || running || pending,
												onClick: () => {
													controller.moveTask(current.id, status);
												},
												children: t(`status.move.${status}`)
											}, status))
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
								className: board_module_css_default.detailFooter,
								children: [
									!archived && pending && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: board_module_css_default.detailMeta,
										children: [t("board.pending"), "…"]
									}),
									!archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: board_module_css_default.ghostButton,
										disabled: pending,
										onClick: () => {
											setShowEdit(true);
										},
										children: t("detail.edit")
									}),
									!archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: board_module_css_default.primaryButton,
										disabled: running || pending,
										onClick: () => {
											controller.rerunTask(current.id).then(() => {
												if (controller.getSnapshot().transportError === void 0) controller.closeTask();
											});
										},
										children: current.executions.length === 0 ? t("detail.run") : t("detail.rerun")
									}),
									archived ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: board_module_css_default.primaryButton,
										disabled: pending,
										onClick: () => {
											controller.restoreTask(current.id);
										},
										children: t("detail.restore")
									}) : (current.status === "done" || current.status === "failed") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: board_module_css_default.ghostButton,
										disabled: pending,
										onClick: () => {
											controller.archiveTask(current.id);
										},
										children: t("detail.archive")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: board_module_css_default.dangerButton,
										disabled: pending,
										onClick: () => {
											setConfirmDelete(true);
										},
										children: t("detail.delete")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: board_module_css_default.detailMeta,
										children: [
											t("board.created"),
											" ",
											formatTime(current.createdAt, timeZone),
											archived && ` · ${t("detail.archivedAt", { time: formatTime(current.archivedAt, timeZone) })}`
										]
									})
								]
							})
						]
					}),
					confirmDelete && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						title: t("delete.title"),
						message: t("delete.confirm", { name: current.title }),
						confirmLabel: t("delete.ok"),
						danger: true,
						onCancel: () => {
							setConfirmDelete(false);
						},
						onConfirm: () => {
							setConfirmDelete(false);
							controller.deleteTask(current.id);
						}
					}),
					showEdit && !archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditTaskModal, {
						controller,
						task: current,
						onClose: () => {
							setShowEdit(false);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/board/TaskBoard.tsx
		/**
		* Board view: the multi-column kanban that replaces the middle column while
		* active. Cards open the task detail (never execute directly); the header
		* offers a status/line view switch, filter, new-task, and a back-to-chat escape.
		*
		* The same ledger read two ways:
		* - status view (default): the six lifecycle columns;
		* - line view: one column per main line (主线), so a large workstream's node
		*   cards read as one track instead of scattering across six columns.
		*/
		/** Case-insensitive title/description/line/seq match. */
		function matchesFilter(task, filter) {
			if (filter.trim() === "") return true;
			const needle = filter.trim().toLowerCase();
			return task.title.toLowerCase().includes(needle) || task.description.toLowerCase().includes(needle) || (task.line ?? "").toLowerCase().includes(needle) || (task.seq ?? "").toLowerCase().includes(needle);
		}
		/**
		* Status order inside a line group: work in flight first, settled cards last.
		* Deliberately not the column order — inside one line the question is "what is
		* still moving", not "which lifecycle column is this".
		*/
		const LINE_STATUS_ORDER = [
			"running",
			"review",
			"todo",
			"backlog",
			"failed",
			"done"
		];
		/** Bucket cards by main line; order both the groups and the cards inside them. */
		function groupByLine(tasks) {
			const buckets = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const key = task.line ?? "";
				const bucket = buckets.get(key);
				if (bucket === void 0) buckets.set(key, [task]);
				else bucket.push(task);
			}
			return [...buckets.entries()].map(([key, items]) => {
				const sorted = [...items].sort((a, b) => {
					const byStatus = LINE_STATUS_ORDER.indexOf(a.status) - LINE_STATUS_ORDER.indexOf(b.status);
					return byStatus !== 0 ? byStatus : compareSeq(a.seq, b.seq);
				});
				return {
					line: key === "" ? void 0 : key,
					tasks: sorted,
					total: sorted.length,
					done: sorted.filter((task) => task.status === "done").length,
					inflight: sorted.filter((task) => task.status !== "done" && task.status !== "failed").length
				};
			}).sort((a, b) => {
				if (a.line === void 0) return 1;
				if (b.line === void 0) return -1;
				if (b.inflight !== a.inflight) return b.inflight - a.inflight;
				return a.line.localeCompare(b.line, "zh");
			});
		}
		/**
		* Archived cards per main line. Archived cards are filtered out of the columns,
		* so without this count a line reads as "0/0 · nothing here" even though the
		* work was done and filed away — the header badge is what tells the difference
		* between "never started" and "already cleared out".
		*/
		function countArchivedByLine(tasks) {
			const counts = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				if (task.archivedAt === void 0) continue;
				const key = task.line ?? "";
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
			return counts;
		}
		/**
		* Memoized per-card adapter: with a stable `onOpen` from the board and an
		* immutable task record (only the changed card gets a new object ref), a card
		* re-renders only when its own task changes — not when a sibling card status,
		* the filter, or the selection moves.
		*/
		const MemoTaskCard = (0, react.memo)(function MemoTaskCard({ task, pending, timeZone, showStatus, onOpen }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
				task,
				pending,
				timeZone,
				showStatus,
				onClick: (0, react.useCallback)(() => {
					onOpen(task.id);
				}, [task.id, onOpen])
			});
		});
		/** Board component; subscribes to the controller snapshot. */
		function TaskBoard({ controller }) {
			const [snapshot, setSnapshot] = (0, react.useState)(controller.getSnapshot());
			(0, react.useEffect)(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
			const [filter, setFilter] = (0, react.useState)("");
			const [view, setView] = (0, react.useState)("status");
			const [showNew, setShowNew] = (0, react.useState)(false);
			const selected = selectedTaskOf(snapshot);
			const archiveView = snapshot.archiveView;
			const visible = snapshot.tasks.filter((task) => (archiveView ? task.archivedAt !== void 0 : task.archivedAt === void 0) && matchesFilter(task, filter));
			const lineGroups = groupByLine(visible);
			const lineArchiveCounts = countArchivedByLine(snapshot.tasks.filter((task) => matchesFilter(task, filter)));
			const openTask = (0, react.useCallback)((id) => {
				controller.openTask(id);
			}, [controller]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: board_module_css_default.board,
				"data-dsh-taskboard-board": "",
				"data-dsh-plugin": "task-board",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: board_module_css_default.boardHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `${board_module_css_default.ghostButton} ${board_module_css_default.backButton}`,
								"data-dsh-center-view-back": "",
								"aria-label": t("board.close"),
								onClick: () => {
									controller.closeBoard();
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "‹"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("board.close") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: board_module_css_default.boardTitle,
								children: t("board.title")
							}),
							snapshot.host !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: board_module_css_default.detailMeta,
								children: t("board.hostMeta", {
									revision: String(snapshot.host.revision),
									timeZone: snapshot.host.scheduler.timeZone
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: board_module_css_default.search,
								type: "search",
								placeholder: t("board.search"),
								value: filter,
								onChange: (event) => {
									setFilter(event.target.value);
								},
								"aria-label": t("board.search")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: view === "status" ? board_module_css_default.primaryButton : board_module_css_default.ghostButton,
								onClick: () => {
									setView("status");
								},
								children: t("board.viewStatus")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: view === "line" ? board_module_css_default.primaryButton : board_module_css_default.ghostButton,
								onClick: () => {
									setView("line");
								},
								children: t("board.viewLine")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: archiveView ? board_module_css_default.primaryButton : board_module_css_default.ghostButton,
								onClick: () => {
									controller.toggleArchiveView();
								},
								children: archiveView ? t("board.backToBoard") : t("board.archiveView", { count: String(snapshot.tasks.filter((task) => task.archivedAt !== void 0).length) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: board_module_css_default.primaryButton,
								onClick: () => {
									setShowNew(true);
								},
								children: ["+ ", t("board.new")]
							})
						]
					}),
					snapshot.transportError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: board_module_css_default.formError,
						children: [
							t("board.hostError", { error: snapshot.transportError }),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: board_module_css_default.linkButton,
								onClick: () => {
									controller.retryHostSync();
								},
								children: t("board.retryHost")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: view === "line" && !archiveView ? `${board_module_css_default.columns} ${board_module_css_default.columnsLine}` : board_module_css_default.columns,
						children: archiveView ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: board_module_css_default.column,
							"data-status": "archived",
							"data-dsh-part": "column",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: board_module_css_default.columnHeader,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: board_module_css_default.columnTitle,
									children: t("board.archive")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: board_module_css_default.columnCount,
									children: visible.length
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: board_module_css_default.cards,
								children: [visible.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoTaskCard, {
									task,
									pending: snapshot.pendingTaskIds.includes(task.id),
									timeZone: snapshot.host?.scheduler.timeZone,
									showStatus: true,
									onOpen: openTask
								}, task.id)), visible.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: board_module_css_default.columnEmpty,
									children: t("archive.empty")
								})]
							})]
						}) : view === "line" ? lineGroups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
							className: board_module_css_default.column,
							"data-dsh-part": "line",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: board_module_css_default.columnEmpty,
								children: t("board.lineEmpty")
							})
						}) : lineGroups.map((group) => {
							const archived = lineArchiveCounts.get(group.line ?? "") ?? 0;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: board_module_css_default.column,
								"data-dsh-part": "line",
								"data-line": group.line ?? "",
								title: t("board.lineHeader", {
									inflight: String(group.inflight),
									done: String(group.done),
									total: String(group.total)
								}),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
									className: board_module_css_default.columnHeader,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: board_module_css_default.columnTitle,
											children: group.line ?? t("board.lineUnassigned")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: board_module_css_default.columnCount,
											children: [
												group.done,
												"/",
												group.total
											]
										}),
										archived > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${board_module_css_default.columnCount} ${board_module_css_default.columnCountArchived}`,
											"data-dsh-part": "line-archived",
											title: t("board.lineArchivedHint", { count: String(archived) }),
											children: t("board.lineArchived", { count: String(archived) })
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: board_module_css_default.cards,
									children: group.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoTaskCard, {
										task,
										pending: snapshot.pendingTaskIds.includes(task.id),
										timeZone: snapshot.host?.scheduler.timeZone,
										showStatus: true,
										onOpen: openTask
									}, task.id))
								})]
							}, group.line ?? "__unassigned");
						}) : COLUMNS.map((column) => {
							const tasks = visible.filter((task) => task.status === column.status);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: board_module_css_default.column,
								"data-status": column.status,
								"data-dsh-part": "column",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
									className: board_module_css_default.columnHeader,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: board_module_css_default.statusDot,
											"data-status": column.status,
											"aria-hidden": "true"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: board_module_css_default.columnTitle,
											children: t(STATUS_KEY[column.status])
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: board_module_css_default.columnCount,
											children: tasks.length
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: board_module_css_default.cards,
									children: [tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoTaskCard, {
										task,
										pending: snapshot.pendingTaskIds.includes(task.id),
										timeZone: snapshot.host?.scheduler.timeZone,
										onOpen: openTask
									}, task.id)), tasks.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: board_module_css_default.columnEmpty,
										children: t("board.empty")
									})]
								})]
							}, column.status);
						})
					}),
					selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskDetail, {
						controller,
						task: selected
					}),
					showNew && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NewTaskModal, {
						controller,
						onClose: () => {
							setShowNew(false);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/board-mount.tsx
		/**
		* Board view mounting.
		*
		* The `conversation` slot is single-occupant (ui-conversation) and external
		* plugins cannot declare slots, so the board takes over the center column at
		* the DOM level: a container is appended inside the center column
		* (`[class*="centerCol"]`, the dsh 0.1.0-rc.6 AppFrame layout; previously
		* `[data-pane="conversation"]` on older shells — the mount selector keeps both)
		* as an extra trailing child
		* React never manages, and a stylesheet
		* rule hides the conversation content while the board is active. Toggling is
		* a data attribute on <html> — no React involvement, so the conversation
		* subtree underneath stays mounted and stateful.
		*/
		const CONVERSATION_COLUMN_SELECTOR = "[data-pane=\"conversation\"], [class*=\"centerCol\"]";
		const ACTIVE_ATTR = "data-dsh-taskboard-active";
		/** The sibling panel's activation attribute (ssh), removed when this panel opens. */
		const OTHER_ACTIVE_ATTR = "data-dsh-ssh-active";
		/** Cross-plugin activation event; detail is the activating panel name. */
		const ACTIVATE_EVENT = "dsh-panel-activate";
		const PANEL_NAME = "taskboard";
		/** Find the center column, or undefined while the frame is not mounted. */
		function conversationColumn() {
			return document.querySelector(CONVERSATION_COLUMN_SELECTOR) ?? void 0;
		}
		/**
		* Mount the board React tree into the center column and bind its visibility
		* to the controller's boardOpen state.
		* @param controller - the board controller driving the view.
		* @returns disposer unmounting the tree and restoring the column.
		*/
		function mountBoard(controller) {
			let root;
			let container;
			const ensure = () => {
				if (container !== void 0) return;
				const column = conversationColumn();
				if (column === void 0) return;
				container = document.createElement("div");
				container.dataset.dshTaskboardView = "";
				container.dataset.dshPlugin = "task-board";
				container.className = board_module_css_default.boardView;
				column.appendChild(container);
				root = (0, react_dom_client.createRoot)(container);
				root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskBoard, { controller }));
			};
			const waitObserver = new MutationObserver(() => {
				ensure();
			});
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const applyActive = () => {
				if (controller.getSnapshot().boardOpen) {
					document.documentElement.removeAttribute(OTHER_ACTIVE_ATTR);
					document.documentElement.setAttribute(ACTIVE_ATTR, "");
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
				} else document.documentElement.removeAttribute(ACTIVE_ATTR);
			};
			const onOtherActivate = (event) => {
				if (event.detail === "ssh" && controller.getSnapshot().boardOpen) controller.closeBoard();
			};
			const SIDEBAR_ROW_SELECTOR = "[class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
			const onClickSidebarRow = (event) => {
				if (!controller.getSnapshot().boardOpen) return;
				const target = event.target;
				if (target === null) return;
				if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.closeBoard();
			};
			document.addEventListener("click", onClickSidebarRow, true);
			document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
			const unsubscribe = controller.subscribe(applyActive);
			applyActive();
			ensure();
			return () => {
				document.removeEventListener("click", onClickSidebarRow, true);
				document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
				waitObserver.disconnect();
				unsubscribe();
				document.documentElement.removeAttribute(ACTIVE_ATTR);
				root?.unmount();
				root = void 0;
				container?.remove();
				container = void 0;
			};
		}
		//#endregion
		//#region src/client/sidebar-entry-core.ts
		/** Find the sidebar shell root element, or undefined while not yet mounted. */
		function sidebarRoot() {
			const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
			if (column === null) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
		}
		/** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
		function newSessionButton(root) {
			const nested = root.querySelector("button[class*=\"newSession\"]");
			if (nested !== null) return nested;
			for (const child of root.children) if (child.tagName === "BUTTON") return child;
		}
		/** Build the entry row (a detached button; insert once the shell is up). */
		function createEntry(options) {
			const entry = document.createElement("button");
			entry.type = "button";
			entry.setAttribute(options.rowAttribute, "");
			if (options.plugin !== void 0) {
				entry.setAttribute("data-dsh-plugin", options.plugin);
				entry.setAttribute("data-dsh-part", "sidebar-entry");
			}
			entry.className = options.css["entry"] ?? "";
			entry.setAttribute("aria-label", options.label());
			if (options.tooltip !== void 0) entry.setAttribute("title", options.tooltip());
			entry.innerHTML = "<span class=\"" + (options.css["entryIcon"] ?? "") + "\">" + options.icon + "</span><span class=\"" + (options.css["entryLabel"] ?? "") + "\">" + options.label() + "</span>";
			entry.addEventListener("click", options.onToggle);
			return entry;
		}
		/** Re-insert the entry after the New Session row (before the browser region). */
		function placeEntry(root, entry, options) {
			const button = newSessionButton(root);
			if (button === void 0) return false;
			entry.className = (button.className + " " + (options.css["entry"] ?? "")).trim();
			const shellLabel = button.querySelector("span");
			const myLabel = entry.querySelector("[class*=\"entryLabel\"]");
			if (shellLabel !== null && myLabel !== null && typeof shellLabel.className === "string" && shellLabel.className !== "") myLabel.className = shellLabel.className;
			const imagegenToggle = root.querySelector("[data-dsh-imagegen-session-tabs]");
			const mustFollow = imagegenToggle !== null && imagegenToggle.parentElement === root;
			const wrongOrder = entry.parentElement === root && mustFollow && (entry.compareDocumentPosition(imagegenToggle) & Node.DOCUMENT_POSITION_PRECEDING) === 0;
			if (entry.parentElement !== root || wrongOrder) {
				const row = button.closest("[class*=\"logoRow\"]");
				const base = row !== null && row.parentElement === root ? row : button;
				const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(options.familySelectors.join(", ")));
				let anchor;
				if (mustFollow) anchor = imagegenToggle.nextElementSibling;
				else anchor = options.position === "before" ? family.length > 0 ? family[0] : base.nextElementSibling : family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
				root.insertBefore(entry, anchor);
			}
			return true;
		}
		/**
		* Mount the sidebar entry, waiting for the shell to render and self-healing
		* on later React re-renders.
		* @param options - the row's attribute/icon/copy/action/ordering configuration.
		* @returns disposer removing the entry and its observers.
		*/
		function mountSidebarEntry$1(options) {
			if (typeof document !== "undefined" && document.querySelector(options.rowSelector) !== null) return () => {};
			const entry = createEntry(options);
			let root;
			let placed = false;
			const tryPlace = () => {
				if (root !== void 0 && !root.isConnected) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				if (placed) {
					if (document.body.contains(entry)) return;
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				root ??= sidebarRoot();
				if (root === void 0) return;
				placed = placeEntry(root, entry, options);
				if (placed) rootObserver.observe(root, {
					childList: true,
					subtree: true
				});
			};
			const waitObserver = new MutationObserver(() => {
				tryPlace();
			});
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const rootObserver = new MutationObserver(() => {
				if (root === void 0 || !root.isConnected) {
					placed = false;
					tryPlace();
					return;
				}
				if (!root.contains(entry)) placed = placeEntry(root, entry, options);
			});
			const unsubscribeActive = options.active === void 0 ? void 0 : (() => {
				const syncActive = () => {
					if (options.active.isOpen()) entry.dataset.active = "true";
					else delete entry.dataset.active;
				};
				const unsubscribe = options.active.subscribe(syncActive);
				syncActive();
				return unsubscribe;
			})();
			tryPlace();
			return () => {
				waitObserver.disconnect();
				rootObserver.disconnect();
				unsubscribeActive?.();
				entry.remove();
			};
		}
		//#endregion
		//#region src/client/sidebar-entry.ts
		/** Stable data attribute identifying the injected entry row. */
		const ENTRY_SELECTOR = "[data-dsh-taskboard-entry]";
		/** Inline icon normalized to the shell's 18px navigation glyph size. */
		const ICON = "<svg viewBox=\"0 0 16 16\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"2\" y=\"2.5\" width=\"12\" height=\"11\" rx=\"1.5\"/><path d=\"M2 6.5h12M6.5 6.5v7\"/></svg>";
		/**
		* Mount the sidebar entry, waiting for the shell to render and self-healing
		* on later React re-renders.
		* @param controller - the board controller the entry toggles.
		* @returns disposer removing the entry and its observers.
		*/
		function mountSidebarEntry(controller) {
			return mountSidebarEntry$1({
				rowAttribute: "data-dsh-taskboard-entry",
				rowSelector: ENTRY_SELECTOR,
				plugin: "task-board",
				icon: ICON,
				css: board_module_css_default,
				label: () => t("entry.label"),
				onToggle: () => {
					controller.toggleBoard();
				},
				position: "before",
				familySelectors: ["[data-dsh-taskboard-entry]", "[data-dsh-ssh-entry]"],
				active: {
					subscribe: (listener) => controller.subscribe(listener),
					isOpen: () => controller.getSnapshot().boardOpen
				}
			});
		}
		//#endregion
		//#region \0dsh-css:src/client/settings-card.module.css.mjs
		const css = ".eAtMra_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.eAtMra_card:hover{border-color:var(--dsw-alias-label-dimmed)}.eAtMra_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.eAtMra_header{appearance:none;box-sizing:border-box;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.eAtMra_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.eAtMra_headerStatic{box-sizing:border-box;border-radius:12px;align-items:center;gap:12px;width:100%;padding:14px 16px;display:flex}.eAtMra_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.eAtMra_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.eAtMra_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.eAtMra_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.eAtMra_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.eAtMra_chevronOpen{transform:rotate(180deg)}.eAtMra_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.eAtMra_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.eAtMra_notExposed{color:var(--dsw-alias-state-warn-primary);margin:12px 0 0;font-size:12px;line-height:1.5}.eAtMra_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.eAtMra_failed{min-width:0;color:var(--dsw-alias-label-error);text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0;font-size:12px;line-height:1.5;overflow:hidden}.eAtMra_discard,.eAtMra_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.eAtMra_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.eAtMra_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.eAtMra_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.eAtMra_discard:disabled,.eAtMra_save:disabled{opacity:.4;cursor:default}.eAtMra_discard:focus-visible,.eAtMra_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.eAtMra_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.eAtMra_field+.eAtMra_field{border-top:1px solid var(--dsw-alias-border-l2)}.eAtMra_head{align-items:center;gap:8px;display:flex}.eAtMra_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.eAtMra_badges{align-items:center;gap:8px;display:inline-flex}.eAtMra_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.eAtMra_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.eAtMra_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.eAtMra_reset:disabled{cursor:default}.eAtMra_reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.eAtMra_input,.eAtMra_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.eAtMra_input:focus-visible,.eAtMra_select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.eAtMra_input:disabled,.eAtMra_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.eAtMra_inputInvalid{border:1px solid var(--dsw-alias-label-error);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.eAtMra_inputInvalid:focus-visible{outline:2px solid var(--dsw-alias-label-error);outline-offset:1px;border-color:var(--dsw-alias-label-error)}.eAtMra_selectWrap{position:relative}.eAtMra_selectButton{appearance:none;text-align:left;cursor:pointer;justify-content:space-between;align-items:center;gap:8px;width:100%;display:flex}.eAtMra_selectLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.eAtMra_selectChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.eAtMra_selectChevronOpen{transform:rotate(180deg)}.eAtMra_selectPopup{z-index:40;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);max-height:240px;box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2);opacity:0;border-radius:8px;flex-direction:column;padding:4px;transition:opacity .1s,transform .1s;display:flex;position:absolute;top:calc(100% + 4px);left:0;right:0;overflow-y:auto;transform:translateY(-4px)}.eAtMra_selectPopupOpen{opacity:1;transform:none}.eAtMra_selectPopupClose{opacity:0;pointer-events:none;transform:translateY(-4px)}.eAtMra_selectOption{color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;text-overflow:ellipsis;border-radius:6px;flex-shrink:0;padding:6px 10px;font-size:13px;line-height:1.5;overflow:hidden}.eAtMra_selectOption:hover,.eAtMra_selectOptionActive{background:var(--dsw-alias-interactive-bg-hover)}.eAtMra_selectOptionSelected{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 10%, transparent);font-weight:500}.eAtMra_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}.eAtMra_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}@media (prefers-reduced-motion:reduce){.eAtMra_card,.eAtMra_header,.eAtMra_chevron,.eAtMra_chevronOpen,.eAtMra_discard,.eAtMra_save,.eAtMra_selectChevron,.eAtMra_selectChevronOpen,.eAtMra_selectPopup{transition:none}}";
		const tagId = "@kira905/dsh-task-board-local/src/client/settings-card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@kira905/dsh-task-board-local";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var settings_card_module_css_default = {
			"badge": "eAtMra_badge",
			"badges": "eAtMra_badges",
			"body": "eAtMra_body",
			"card": "eAtMra_card",
			"cardOpen": "eAtMra_cardOpen",
			"chevron": "eAtMra_chevron",
			"chevronOpen": "eAtMra_chevronOpen",
			"description": "eAtMra_description",
			"discard": "eAtMra_discard",
			"failed": "eAtMra_failed",
			"field": "eAtMra_field",
			"footer": "eAtMra_footer",
			"head": "eAtMra_head",
			"headText": "eAtMra_headText",
			"header": "eAtMra_header",
			"headerStatic": "eAtMra_headerStatic",
			"hint": "eAtMra_hint",
			"input": "eAtMra_input",
			"inputInvalid": "eAtMra_inputInvalid",
			"invalid": "eAtMra_invalid",
			"label": "eAtMra_label",
			"name": "eAtMra_name",
			"notExposed": "eAtMra_notExposed",
			"pending": "eAtMra_pending",
			"readOnly": "eAtMra_readOnly",
			"reset": "eAtMra_reset",
			"save": "eAtMra_save",
			"select": "eAtMra_select",
			"selectButton": "eAtMra_selectButton",
			"selectChevron": "eAtMra_selectChevron",
			"selectChevronOpen": "eAtMra_selectChevronOpen",
			"selectLabel": "eAtMra_selectLabel",
			"selectOption": "eAtMra_selectOption",
			"selectOptionActive": "eAtMra_selectOptionActive",
			"selectOptionSelected": "eAtMra_selectOptionSelected",
			"selectPopup": "eAtMra_selectPopup",
			"selectPopupClose": "eAtMra_selectPopupClose",
			"selectPopupOpen": "eAtMra_selectPopupOpen",
			"selectWrap": "eAtMra_selectWrap"
		};
		//#endregion
		//#region src/client/PluginSettingsCard.tsx
		/**
		* Family-shared chrome for plugin settings cards: a disclosure header naming
		* the plugin and what its settings govern, the controls inside, and the save
		* that writes them. Renders nothing while the namespace is unavailable — a
		* deployment that does not compose the owning plugin should show no trace of
		* it. Inlined into each consumer's client bundle; mirrors the official
		* ui-plugin-config PluginCard in a self-contained slice.
		*/
		/**
		* Render one plugin settings card.
		* @param props - the plugin's copy keys, its form state, and its controls.
		* @returns the card, or nothing while the namespace is still loading.
		*/
		function PluginSettingsCard(props) {
			const [open, setOpen] = (0, react.useState)(props.defaultOpen ?? true);
			const { state, alwaysOpen } = props;
			if (!state.available) return null;
			const title = props.t(props.titleKey);
			const description = props.t(props.descriptionKey);
			const blocked = !state.dirty || state.invalid || state.saving;
			const expanded = alwaysOpen === true || open;
			const cardClass = expanded ? `${settings_card_module_css_default.cardOpen} ${settings_card_module_css_default.card}` : settings_card_module_css_default.card;
			const header = alwaysOpen === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.headerStatic,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: settings_card_module_css_default.headText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.name,
						title,
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.description,
						title: description,
						children: props.descriptionNode ?? description
					})]
				}), state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: settings_card_module_css_default.pending,
					title: props.t("settings.unsaved"),
					children: props.t("settings.unsaved")
				}) : null]
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: settings_card_module_css_default.header,
				"aria-expanded": open,
				"aria-label": `${props.t(open ? "settings.collapse" : "settings.expand")}: ${title}`,
				onClick: () => {
					setOpen(!open);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: settings_card_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.name,
							title,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.description,
							title: description,
							children: props.descriptionNode ?? description
						})]
					}),
					state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.pending,
						title: props.t("settings.unsaved"),
						children: props.t("settings.unsaved")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						fill: "none",
						xmlns: "http://www.w3.org/2000/svg",
						className: open ? `${settings_card_module_css_default.chevron} ${settings_card_module_css_default.chevronOpen}` : settings_card_module_css_default.chevron,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
							fill: "currentColor"
						})
					})
				]
			});
			if (!state.exposed) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: cardClass,
				children: [header, expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: settings_card_module_css_default.body,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.notExposed,
						role: "status",
						children: props.t("settings.notExposed")
					})
				}) : null]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: cardClass,
				children: [header, expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: settings_card_module_css_default.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: settings_card_module_css_default.readOnly,
							role: "status",
							children: props.t("settings.readOnly")
						}) : null,
						props.children,
						props.hideFooter === true ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: settings_card_module_css_default.footer,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: settings_card_module_css_default.failed,
									role: "status",
									children: [props.t("settings.saveFailed"), state.failedReason ? " - " + state.failedReason : ""]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.discard,
									disabled: !state.dirty || state.saving,
									onClick: props.onDiscard,
									children: props.t("settings.discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.save,
									disabled: blocked,
									onClick: props.onSave,
									children: props.t(!state.saving ? "settings.save" : "settings.saving")
								})
							]
						})
					]
				}) : null]
			});
		}
		const NON_SKIN_BODY_MARKERS = /* @__PURE__ */ new Set(["dshSkinCenter", "dshSidebarCollapsed"]);
		function isSkinActive() {
			return Object.keys(document.body.dataset).some((key) => key.startsWith("dsh") && !NON_SKIN_BODY_MARKERS.has(key));
		}
		const SELECT_CLOSE_MS = 100;
		/**
		* The shared dual-mode select control. While an appearance skin is active it
		* renders the legacy native `<select>` untouched, so element-level skin
		* selectors keep working; under the default appearance it renders a
		* self-drawn `role="listbox"` popup whose open/close is transition-animated.
		* Staged cards reach it through BooleanField/ChoiceField; immediate-apply
		* editors (the side-card prefs) bind it directly through onEdit.
		* 双模式下拉框：皮肤激活时用原生 select，默认外观用自绘动画弹层。
		*/
		function SelectField(props) {
			const { id, options, value } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const [closing, setClosing] = (0, react.useState)(false);
			const [phase, setPhase] = (0, react.useState)("initial");
			const [activeIndex, setActiveIndex] = (0, react.useState)(0);
			const closeTimer = (0, react.useRef)(void 0);
			const wrapRef = (0, react.useRef)(null);
			const popupRef = (0, react.useRef)(null);
			const currentIndex = () => {
				const index = options.findIndex((option) => option.value === value);
				return index >= 0 ? index : 0;
			};
			const close = (0, react.useCallback)(() => {
				if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
				setClosing(true);
				closeTimer.current = setTimeout(() => {
					setClosing(false);
					setOpen(false);
				}, SELECT_CLOSE_MS);
			}, []);
			const openPopup = () => {
				if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
				setActiveIndex(currentIndex());
				setPhase("initial");
				setClosing(false);
				setOpen(true);
			};
			const commit = (index) => {
				const option = options[index];
				if (option) props.onEdit(option.value);
				close();
			};
			const onTriggerClick = () => {
				if (props.disabled) return;
				if (open && !closing) close();
				else openPopup();
			};
			const onKeyDown = (event) => {
				if (props.disabled) return;
				const count = options.length;
				switch (event.key) {
					case "ArrowDown":
					case "ArrowUp":
					case "Enter":
					case " ":
						event.preventDefault();
						if (!open) openPopup();
						else if (!closing) if (event.key === "ArrowDown") setActiveIndex((index) => (index + 1) % count);
						else if (event.key === "ArrowUp") setActiveIndex((index) => (index - 1 + count) % count);
						else commit(activeIndex);
						break;
					case "Escape":
						if (open) {
							event.preventDefault();
							event.stopPropagation();
							close();
						}
						break;
					case "Tab":
						if (open) close();
						break;
				}
			};
			(0, react.useEffect)(() => () => {
				if (closeTimer.current !== void 0) clearTimeout(closeTimer.current);
			}, []);
			(0, react.useLayoutEffect)(() => {
				if (open && !closing && phase === "initial") {
					popupRef.current?.offsetHeight;
					setPhase("open");
				}
			}, [
				open,
				closing,
				phase
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (target instanceof Node && !wrapRef.current?.contains(target)) close();
				};
				document.addEventListener("pointerdown", onPointerDown);
				return () => document.removeEventListener("pointerdown", onPointerDown);
			}, [open, close]);
			(0, react.useEffect)(() => {
				if (props.disabled && open) close();
			}, [
				props.disabled,
				open,
				close
			]);
			if (isSkinActive()) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				id,
				className: settings_card_module_css_default.select,
				value,
				disabled: props.disabled,
				onChange: (event) => {
					props.onEdit(event.target.value);
				},
				children: options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: option.value,
					children: option.label
				}, option.value))
			});
			const label = options.find((option) => option.value === value)?.label ?? "";
			const popupClass = closing ? `${settings_card_module_css_default.selectPopup} ${settings_card_module_css_default.selectPopupClose}` : phase === "open" ? `${settings_card_module_css_default.selectPopup} ${settings_card_module_css_default.selectPopupOpen}` : settings_card_module_css_default.selectPopup;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.selectWrap,
				ref: wrapRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					id,
					className: `${settings_card_module_css_default.select} ${settings_card_module_css_default.selectButton}`,
					disabled: props.disabled,
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					"aria-activedescendant": open ? `${id}-o${activeIndex}` : void 0,
					"aria-invalid": props.invalid || void 0,
					onClick: onTriggerClick,
					onKeyDown,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: settings_card_module_css_default.selectLabel,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						fill: "none",
						xmlns: "http://www.w3.org/2000/svg",
						className: open ? `${settings_card_module_css_default.selectChevron} ${settings_card_module_css_default.selectChevronOpen}` : settings_card_module_css_default.selectChevron,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
							fill: "currentColor"
						})
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: popupClass,
					role: "listbox",
					ref: popupRef,
					children: options.map((option, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						id: `${id}-o${index}`,
						role: "option",
						"aria-selected": option.value === value,
						className: `${settings_card_module_css_default.selectOption}${option.value === value ? ` ${settings_card_module_css_default.selectOptionSelected}` : ""}${index === activeIndex && !closing ? ` ${settings_card_module_css_default.selectOptionActive}` : ""}`,
						onClick: () => {
							commit(index);
						},
						children: option.label
					}, option.value))
				}) : null]
			});
		}
		/** A staged boolean field: 继承 / 开 / 关. */
		function BooleanField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: settings_card_module_css_default.label,
							htmlFor: props.id,
							children: props.label
						}), props.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: settings_card_module_css_default.badges,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: settings_card_module_css_default.badge,
								children: props.overriddenLabel
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: settings_card_module_css_default.reset,
								disabled: props.disabled,
								onClick: props.onReset,
								children: props.resetLabel
							})]
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
						id: props.id,
						options: [
							{
								value: "",
								label: props.inheritLabel
							},
							{
								value: "true",
								label: props.onLabel
							},
							{
								value: "false",
								label: props.offLabel
							}
						],
						value: props.text,
						disabled: props.disabled,
						invalid: props.invalid,
						onEdit: props.onEdit
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.hint,
						children: props.hint
					})
				]
			});
		}
		//#endregion
		//#region src/client/client-faces.ts
		/**
		* Create a snapshot store over an in-memory value.
		*
		* Only the surface this plugin uses is implemented: synchronous notification on
		* `set` (controlled inputs need same-tick echo), a stable `getSnapshot`
		* reference between changes, and no persistence. The upstream helper carried an
		* immer-draft `update()` and an optional localStorage mode; neither is used by
		* this plugin, so neither is modelled here — a store method nobody calls is a
		* silent wrong-behaviour trap, not a feature.
		* @param init - initial state.
		* @returns the store.
		*/
		function createSnapshotStore(init) {
			let state = init;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set: (next) => {
					state = next;
					for (const listener of [...listeners]) listener();
				}
			};
		}
		//#endregion
		//#region src/client/settings-form.ts
		/**
		* Staged form model behind the plugin settings card. A card stages what the
		* user types and writes it only when they save — the settings write is a
		* durable, revision-fenced document mutation, so staging keeps what is on
		* screen exactly what a save would store. Family-shared slice inlined into
		* each plugin's client bundle; mirrors the official ui-plugin-config
		* card-store pattern.
		*/
		/** A boolean field, edited through true/false draft text. */
		function booleanField(field) {
			return {
				field,
				format: (value) => typeof value === "boolean" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true") return {
						kind: "set",
						value: true
					};
					if (trimmed === "false") return {
						kind: "set",
						value: false
					};
				}
			};
		}
		/**
		* Stages one card's edits over one settings namespace and writes them on save.
		*
		* The Host is the only authority on whether a value was accepted — its
		* validators own the constraints no schema can express — so the outcome is
		* read back from the section rather than predicted here. A save that did not
		* land keeps its drafts, so the user can correct them instead of retyping.
		*/
		var CardForm = class {
			scope;
			specs;
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			/** The scope subscription installed in the constructor; released by dispose(). */
			disposeScope;
			disposed = false;
			saving = false;
			failed = false;
			failedReason;
			/** @param scope - the bound settings scope for this card's namespace. */
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.disposeScope = scope.subscribe(() => {
					this.publish();
				});
			}
			/**
			* Release the scope subscription and every bound store listener. The card
			* must call this on teardown; later calls are no-ops.
			*/
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.disposeScope();
				this.listeners.clear();
			}
			/** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
			bind(project) {
				const store = createSnapshotStore(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Read the card-level state: what the Host serves, and what a save would do. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status !== "loading",
					exposed: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed,
					...this.failedReason === void 0 ? {} : { failedReason: this.failedReason }
				};
			}
			/** Read one field's state from the effective section and its staged draft. */
			field(field) {
				const spec = this.specOf(field);
				const staged = this.staged.get(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			/** The actions the card's slot registration injects. */
			actions() {
				return {
					edit: (field, text) => {
						this.stage(field, {
							text,
							clear: false
						});
					},
					resetField: (field) => {
						this.stage(field, {
							text: this.specOf(field).format(this.baseValue(field)),
							clear: true
						});
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.failedReason = void 0;
						this.publish();
					}
				};
			}
			/**
			* Write every staged edit, then re-seed from what the Host accepted.
			*
			* When the scope carries the optional batch surface (the dsh-web
			* bridge scope), every planned write rides one mutation so cross-field
			* validate hooks (baseURL+model) judge the batch as a unit instead of
			* deadlocking on per-field writes. Otherwise the per-field loop runs.
			* A field lands only when the Host reports it held the staged value; a
			* landed field's draft is dropped, a failed one stays staged for the user.
			* @returns settlement after every write and the read-back.
			*/
			async save() {
				const plan = this.plan();
				const valid = plan.filter((item) => item.run !== void 0);
				if (plan.length === 0 || this.saving || valid.length !== plan.length) return;
				const plannedWrites = valid.map((item) => item.op);
				const pending = /* @__PURE__ */ new Map();
				for (const item of plan) pending.set(item.field, this.staged.get(item.field));
				this.saving = true;
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
				const landed = /* @__PURE__ */ new Set();
				const batch = this.batchedScope();
				if (batch !== void 0) {
					const result = await batch.mutate(plannedWrites);
					if (result.ok) {
						for (const field of result.fields) if (field.landed) landed.add(field.field);
					} else this.failedReason = result.message;
				} else for (const item of valid) if (await item.run()) landed.add(item.field);
				for (const [field, before] of pending) if (landed.has(field) && this.staged.get(field) === before) this.staged.delete(field);
				this.saving = false;
				this.failed = landed.size !== pending.size;
				this.publish();
			}
			/** The scope's batch surface when it supports one; undefined conservatively otherwise. */
			batchedScope() {
				const candidate = this.scope;
				return typeof candidate?.mutate === "function" ? candidate : void 0;
			}
			/**
			* Every staged edit a save would write. An entry whose draft is not a value
			* its field accepts carries no write: the form is still dirty, and the save
			* refuses rather than dropping the edit. A staged edit that matches the
			* effective section is not a write at all.
			* @returns the planned writes, in the order the fields were staged.
			*/
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const spec = this.specOf(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({
							field,
							op: {
								field,
								op: "unset"
							},
							run: () => this.clear(field)
						});
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({
						field,
						op: {
							field,
							op: "unset"
						},
						run: void 0
					});
					else if (write.kind === "clear") plan.push({
						field,
						op: {
							field,
							op: "unset"
						},
						run: () => this.clear(field)
					});
					else plan.push({
						field,
						op: {
							field,
							op: "set",
							value: write.value
						},
						run: () => this.store(field, write.value)
					});
				}
				return plan;
			}
			async clear(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				if (this.specOf(field).secret) return true;
				return this.userLayer()?.[field] === value;
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.failedReason = void 0;
				this.publish();
			}
			specOf(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`settings card has no field ${field}`);
				return spec;
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return this.snapshotOf().value?.[field];
			}
			baseValue(field) {
				return this.snapshotOf().base?.[field];
			}
			userLayer() {
				return this.snapshotOf().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/TaskBoardSettingsCard.tsx
		/** Bridges the `task-board` scope onto the card's staged form. */
		var TaskBoardSettingsCardController = class {
			form;
			store;
			/** @param scope - the bound settings scope for the `task-board` namespace. */
			constructor(scope) {
				this.form = new CardForm(scope, [
					booleanField("enabled"),
					booleanField("announceToAgent"),
					booleanField("preventIdleSleep")
				]);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					enabled: this.form.field("enabled"),
					announceToAgent: this.form.field("announceToAgent"),
					preventIdleSleep: this.form.field("preventIdleSleep")
				};
			}
			/**
			* Build the face the card's slot registration injects.
			* @returns the card's snapshot and its form actions.
			*/
			inject() {
				return {
					hooks: { taskBoardSettingsCard: this.store },
					...this.form.actions()
				};
			}
			/**
			* Release the card's scope subscription and bound stores; the slot
			* disposer calls this on teardown.
			*/
			dispose() {
				this.form.dispose();
			}
		};
		/**
		* Render the task-board card.
		* @param props - locale copy, the card snapshot, and its form actions.
		* @returns the card.
		*/
		function TaskBoardSettingsCard(props) {
			const { t } = props;
			const state = props.useTaskBoardSettingsCard((snapshot) => snapshot);
			const disabled = !state.writable;
			const [power, setPower] = (0, react.useState)();
			const powerRef = (0, react.useRef)(null);
			const [statusLive, setStatusLive] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const node = powerRef.current;
				let intersecting = false;
				const onScreen = () => node !== null && node.isConnected && node.offsetParent !== null && intersecting && document.visibilityState === "visible";
				if (node === null || typeof IntersectionObserver === "undefined") {
					const sync = () => {
						setStatusLive(document.visibilityState === "visible");
					};
					sync();
					document.addEventListener("visibilitychange", sync);
					return () => {
						document.removeEventListener("visibilitychange", sync);
					};
				}
				const sync = () => {
					setStatusLive(onScreen());
				};
				const observer = new IntersectionObserver((entries) => {
					const entry = entries[entries.length - 1];
					intersecting = entry?.isIntersecting === true && (entry.boundingClientRect.height ?? 0) > 0;
					sync();
				});
				observer.observe(node);
				document.addEventListener("visibilitychange", sync);
				return () => {
					observer.disconnect();
					document.removeEventListener("visibilitychange", sync);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!statusLive) return;
				let live = true;
				const events = new EventSource("/api/task-board/events");
				events.onmessage = (message) => {
					try {
						const frame = JSON.parse(message.data);
						if (frame.power !== void 0 && live) setPower(frame.power);
					} catch {}
				};
				return () => {
					live = false;
					events.close();
				};
			}, [statusLive]);
			const fieldProps = {
				overriddenLabel: t("settings.overridden"),
				resetLabel: t("settings.reset"),
				invalidLabel: t("settings.invalidNumber"),
				disabled
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PluginSettingsCard, {
				t,
				titleKey: "settings.title",
				descriptionKey: "settings.description",
				defaultOpen: false,
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BooleanField, {
						id: "settings-task-board-enabled",
						label: t("settings.enabled"),
						hint: t("settings.enabledHint"),
						inheritLabel: t("settings.inherit"),
						onLabel: t("settings.on"),
						offLabel: t("settings.off"),
						...fieldProps,
						...state.enabled,
						onEdit: (text) => {
							props.edit("enabled", text);
						},
						onReset: () => {
							props.resetField("enabled");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BooleanField, {
						id: "settings-task-board-announce",
						label: t("settings.announceToAgent"),
						hint: t("settings.announceToAgentHint"),
						inheritLabel: t("settings.inherit"),
						onLabel: t("settings.on"),
						offLabel: t("settings.off"),
						...fieldProps,
						...state.announceToAgent,
						onEdit: (text) => {
							props.edit("announceToAgent", text);
						},
						onReset: () => {
							props.resetField("announceToAgent");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BooleanField, {
						id: "settings-task-board-prevent-idle-sleep",
						label: t("settings.preventIdleSleep"),
						hint: t("settings.preventIdleSleepHint"),
						inheritLabel: t("settings.inherit"),
						onLabel: t("settings.on"),
						offLabel: t("settings.off"),
						...fieldProps,
						...state.preventIdleSleep,
						onEdit: (text) => {
							props.edit("preventIdleSleep", text);
						},
						onReset: () => {
							props.resetField("preventIdleSleep");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						ref: powerRef,
						children: t("settings.powerStatus", {
							platform: power?.platform ?? t("settings.powerUnknown"),
							phase: power?.phase ?? t("settings.powerUnknown"),
							running: String(power?.runningSessions ?? 0),
							schedules: String(power?.armedSchedules ?? 0)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.powerBoundary") }),
					power?.lastError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.powerError", { error: power.lastError }) })
				]
			});
		}
		//#endregion
		//#region src/protocol.ts
		const TASK_BOARD_API_PREFIX = "/api/task-board";
		//#endregion
		//#region src/client/host-api.ts
		const IMPORT_MARKER = "dsh.taskBoard.v2.hostImported";
		const SOURCE_KEY = "dsh.taskBoard.v2.sourceId";
		const IMPORT_REQUEST_KEY = "dsh.taskBoard.v2.importRequestId";
		const REQUEST_TIMEOUT_MS = 15e3;
		function uuid() {
			return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		}
		async function readJson(response) {
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? `task-board request failed: ${response.status}`);
			return body;
		}
		var HttpTaskBoardHostTransport = class {
			storage;
			constructor(storage = globalThis.localStorage) {
				this.storage = storage;
			}
			async bootstrap(legacy) {
				const initial = await this.state();
				const ledgerId = initial.scheduler.ledgerId;
				if (legacy.length > 0 && ledgerId !== void 0 && this.storage?.getItem(IMPORT_MARKER) !== ledgerId) {
					let sourceId = this.storage?.getItem(SOURCE_KEY);
					if (sourceId === null || sourceId === void 0 || sourceId === "") {
						sourceId = uuid();
						this.storage?.setItem(SOURCE_KEY, sourceId);
					}
					let requestId = this.storage?.getItem(IMPORT_REQUEST_KEY);
					if (requestId === null || requestId === void 0 || requestId === "") {
						requestId = uuid();
						this.storage?.setItem(IMPORT_REQUEST_KEY, requestId);
					}
					const snapshot = await this.post(requestId, {
						kind: "import",
						sourceId,
						tasks: [...legacy]
					});
					this.storage?.setItem(IMPORT_MARKER, snapshot.scheduler.ledgerId ?? ledgerId);
					return snapshot;
				}
				return initial;
			}
			async state() {
				return await this.request(`${TASK_BOARD_API_PREFIX}/state`, { cache: "no-store" });
			}
			async action(action) {
				return await this.post(uuid(), action);
			}
			async post(requestId, action) {
				const envelope = {
					requestId,
					action
				};
				return await this.request(`${TASK_BOARD_API_PREFIX}/action`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(envelope)
				});
			}
			async request(url, init) {
				const controller = new AbortController();
				const timeout = globalThis.setTimeout(() => {
					controller.abort();
				}, REQUEST_TIMEOUT_MS);
				try {
					return await readJson(await fetch(url, {
						...init,
						signal: controller.signal
					}));
				} catch (error) {
					if (controller.signal.aborted) throw new Error(`task-board Host request timed out after ${REQUEST_TIMEOUT_MS / 1e3}s`);
					throw error;
				} finally {
					globalThis.clearTimeout(timeout);
				}
			}
			/**
			* Open the Host event channel (SSE).
			*
			* The demand policy lives with the caller: this transport only opens and
			* closes. The board controller subscribes while the panel is actually on
			* screen and releases the channel otherwise (see BoardController), so a
			* page that is not showing the board holds no SSE connection — one fewer
			* permanently occupied HTTP/1.1 slot per page.
			* @param listener - receives each pushed frame (or undefined on a bad frame).
			* @returns release that closes the EventSource.
			*/
			subscribe(listener) {
				const events = new EventSource(`${TASK_BOARD_API_PREFIX}/events`);
				events.onmessage = (message) => {
					try {
						const parsed = JSON.parse(message.data);
						if (parsed === null || typeof parsed !== "object" || typeof parsed.revision !== "number") throw new Error("invalid event frame");
						listener(parsed);
					} catch {
						listener();
					}
				};
				return () => {
					events.close();
				};
			}
		};
		//#endregion
		//#region src/client/preset-roster.ts
		/**
		* Unwrap one transport's payload into a result envelope.
		*
		* Accepting both envelopes is deliberate: the shallow form is what the Typert
		* namespace resolves, the nested form is what the 0.1.1 RPC client returns, and
		* a reader that insisted on one of them would silently report `malformed` on
		* the other line.
		* @param payload - value the transport resolved to.
		* @returns the business result, or the reason it cannot be read.
		*/
		function unwrapResult(payload) {
			if (payload === null || typeof payload !== "object") return {
				ok: false,
				reason: "malformed"
			};
			const outer = payload;
			const carrier = "result" in outer ? outer.result : outer;
			if (carrier === null || typeof carrier !== "object") return {
				ok: false,
				reason: "malformed"
			};
			const result = carrier;
			if (result.ok === true) return {
				ok: true,
				value: result.value
			};
			if (result.ok === false) return {
				ok: false,
				reason: "rpc-failed"
			};
			return {
				ok: false,
				reason: "malformed"
			};
		}
		/**
		* Narrow one roster value to picker options.
		*
		* Rows without a usable id are dropped rather than mapped: the picker stores
		* the id it renders, so a row that cannot be addressed would offer a choice the
		* board cannot honour.
		* @param value - decoded business value.
		* @returns the options, or undefined when the value is not a roster at all.
		*/
		function toPresetOptions(value) {
			if (value === null || typeof value !== "object") return void 0;
			const presets = value.presets;
			if (!Array.isArray(presets)) return void 0;
			const options = [];
			for (const row of presets) {
				if (row === null || typeof row !== "object") continue;
				const record = row;
				const id = record.id;
				if (typeof id !== "string" || id === "") continue;
				options.push({
					id,
					name: typeof record.name === "string" ? record.name : void 0,
					description: typeof record.description === "string" ? record.description : void 0,
					broken: typeof record.broken === "string" ? record.broken : void 0,
					isDefault: record.isDefault === true
				});
			}
			return options;
		}
		/**
		* Run one transport's call and normalize its outcome.
		* @param transport - label reported on failure.
		* @param call - transport-bound invocation.
		* @returns the read outcome; never rejects.
		*/
		async function invoke(transport, call) {
			let payload;
			try {
				payload = await call();
			} catch (error) {
				return {
					ok: false,
					transport,
					reason: "call-threw",
					error
				};
			}
			const result = unwrapResult(payload);
			if (!result.ok) return {
				ok: false,
				transport,
				reason: result.reason
			};
			const presets = toPresetOptions(result.value);
			if (presets === void 0) return {
				ok: false,
				transport,
				reason: "malformed"
			};
			return {
				ok: true,
				transport,
				presets
			};
		}
		/**
		* Read one transport face without letting a Cordis injection check abort the caller.
		*
		* Cordis resolves a service against the calling fiber and THROWS when the name is
		* not injected there ("cannot get property … without inject"). A client plugin's
		* `apply` must never throw for that reason: the web shell reports it as
		* `failed to apply loader entry` and skips the plugin entirely, so one
		* unreachable optional service would take the whole board UI down. Reading a
		* face this way degrades to "this transport is absent", which the reader already
		* reports.
		* @param read - thunk performing the service read.
		* @returns the face, or undefined when the read is refused.
		*/
		function readTransportFace(read) {
			try {
				return read();
			} catch {
				return;
			}
		}
		/**
		* Read the agent-preset roster from whichever transport this deployment serves.
		*
		* Order is old line first: `connection.api.agentPresets` exists only on 0.1.1,
		* so preferring it keeps that line's behaviour byte-for-byte, and the 0.1.5
		* handle simply has no `api` to prefer. The `remote` namespace is the fallback,
		* not a parallel path — one read, one transport reported.
		* @param transports - transport faces (undefined entries mean "not present").
		* @returns the roster, or a reason it is unavailable. Never rejects.
		*/
		async function readPresetRoster(transports) {
			const { connectionApi, remote } = transports;
			if (connectionApi !== void 0 && typeof connectionApi.list === "function") return await invoke("connection-api", () => connectionApi.list({}));
			if (remote !== void 0 && typeof remote.list === "function") return await invoke("remote", () => remote.list());
			return {
				ok: false,
				transport: "none",
				reason: "no-transport"
			};
		}
		/**
		* One operator-facing line for a failed read.
		*
		* Every reason maps to a distinct, non-empty sentence on purpose: this is the
		* console output that replaces the swallowed TypeError, and an unreadable
		* roster must not be indistinguishable from an empty one.
		* @param read - failed read outcome.
		* @returns the message to log (without the plugin prefix).
		*/
		function formatPresetRosterFailure(read) {
			switch (read.reason) {
				case "no-transport": return "agent preset roster unavailable: neither connection.api.agentPresets (0.1.1) nor remote.agentPresets (0.1.2+) is present — the mode picker stays empty";
				case "call-threw": return `agent preset roster read threw on the ${read.transport} transport`;
				case "rpc-failed": return `agent preset roster read failed on the ${read.transport} transport (host returned a failure result)`;
				case "malformed": return `agent preset roster read on the ${read.transport} transport returned no usable preset list`;
			}
		}
		/**
		* Deduplication key for a failure, so a repeated no-transport read does not
		* flood the console while a genuinely new failure still gets reported.
		* @param read - failed read outcome.
		* @returns a stable key per (transport, reason) pair.
		*/
		function presetRosterFailureKey(read) {
			return `${read.transport}:${read.reason}`;
		}
		//#endregion
		//#region src/client/telemetry.ts
		const VISITOR_KEY = "dsh-web-ui-telemetry-visitor";
		const DAY_KEY_PREFIX = "dsh-web-ui-telemetry-day:";
		const ENDPOINT = "https://dsh-market.com/api/telemetry/event";
		/** The building package's version, when the bundle carries it. */
		function bakedVersion() {
			try {
				return "1.1.5";
			} catch {
				return;
			}
		}
		/** Read or lazily create the anonymous visitor id; null when storage is unavailable. */
		function visitorId() {
			try {
				const existing = localStorage.getItem(VISITOR_KEY);
				if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
				const fresh = crypto.randomUUID().replaceAll("-", "");
				localStorage.setItem(VISITOR_KEY, fresh);
				return fresh;
			} catch {
				return null;
			}
		}
		/** Drop stale per-day dedup keys so localStorage does not grow forever. */
		function pruneDayKeys(today) {
			try {
				for (let index = localStorage.length - 1; index >= 0; index -= 1) {
					const key = localStorage.key(index);
					if (key !== null && key.startsWith(DAY_KEY_PREFIX) && key !== DAY_KEY_PREFIX + today) localStorage.removeItem(key);
				}
			} catch {}
		}
		/**
		* Fire the daily heartbeat for the given items at most once per UTC day per
		* browser. Never throws and never blocks the caller. Items without an explicit
		* version inherit the bundle's baked build version.
		*/
		function reportDailyHeartbeat(items) {
			try {
				if (items.length === 0) return;
				const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
				if (navigator.webdriver) return;
				if (localStorage.getItem(DAY_KEY_PREFIX + today) !== null) return;
				const visitor = visitorId();
				if (visitor === null) return;
				pruneDayKeys(today);
				const payloadItems = items.map((item) => {
					const out = { name: item.name };
					const version = item.version ?? bakedVersion();
					if (version !== void 0) out.version = version;
					if (item.channel !== void 0) out.channel = item.channel;
					return out;
				});
				const body = JSON.stringify({
					kind: "heartbeat",
					visitor,
					items: payloadItems
				});
				fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
					keepalive: true
				}).then((response) => {
					if (response.ok) localStorage.setItem(DAY_KEY_PREFIX + today, "1");
				}).catch(() => {});
			} catch {}
		}
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace this plugin owns. */
		const NS = "task-board";
		/**
		* Settings namespace the settings card edits — one section, two generations
		* with two different names:
		*  - pre-0.2.0: the plugin registered the section itself, under the display
		*    namespace `task-board`;
		*  - 0.2.0: the Host derives the form from the plugin's own live Config and the
		*    namespace IS the profile entry id — here the id this plugin's bundle patch
		*    inserts (`cordis.patch.yml`: `- id: ui-task-board-local`). The display name
		*    never reaches the wire on that line, which is why the browser half keys the
		*    form by the entry id.
		*/
		const TASK_BOARD_LEGACY_NS = "task-board";
		/** Profile entry id serving as the 0.2.0 settings namespace (bundle patch insert id). */
		const TASK_BOARD_ENTRY_ID = "ui-task-board-local";
		/**
		* Required services (fiber inject waiting — the runtime must be up first).
		*
		* `settingsScope` is deliberately absent: it does not exist on 0.2.0, and a
		* statically injected missing service parks the loader entry forever
		* (`pending (waiting for service: settingsScope)`) — the failure that left the
		* browser half of this plugin inert on 2026-10-16. The settings face is reached
		* through a dynamic injection instead, so an absent service degrades to "no
		* settings card" rather than "no GUI".
		*/
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"connection",
			"locale",
			"remote"
		];
		/**
		* Mount the task board.
		* @param ctx - client root context (services: sessions, workspaces).
		*/
		function apply(ctx) {
			reportDailyHeartbeat([{ name: "@linxin666/dsh-client-ui-task-board" }]);
			if (!claimTaskboardApply()) return;
			ctx.effect(() => releaseTaskboardApply, "task-board: apply claim");
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "task-board: dictionaries");
			let settingsScope;
			let settingsCard;
			/**
			* Register the card into one settings seat, tolerating a shell that refuses it.
			* @param options - slot registration options for this seat.
			* @returns the disposer the slot expects.
			*/
			const registerSettingsCard = (options) => {
				const card = settingsCard;
				if (card === void 0) return () => {};
				try {
					const unregister = ctx.slots.register(options, TaskBoardSettingsCard);
					return () => {
						card.dispose();
						unregister();
					};
				} catch (error) {
					console.warn("[dsh-task-board] settings card registration failed:", error);
					return () => {};
				}
			};
			/**
			* Localized label for the 0.2.0 settings seat.
			* @returns the tab text, falling back to English if the locale service cannot bind.
			*/
			const settingsLabel = () => {
				try {
					const locale = ctx.locale;
					return String(locale.bind(NS)("settings.title"));
				} catch {
					return "Task Board";
				}
			};
			ctx.slots.inject("settings.plugins.tab", () => registerSettingsCard({
				name: "settings.plugins.tab",
				id: "task-board",
				order: 110,
				label: settingsLabel,
				locale: NS,
				inject: () => settingsCard?.inject() ?? {}
			}));
			ctx.slots.inject("web-ui.plugin.item", () => registerSettingsCard({
				name: "web-ui.plugin.item",
				id: "task-board",
				order: 110,
				locale: NS,
				inject: () => settingsCard?.inject() ?? {}
			}));
			let uiDisposer;
			let remotePresets;
			let onRemotePresetsReady;
			ctx.inject(["remote.agentPresets"], (scoped) => {
				const namespaces = scoped;
				const dotted = readTransportFace(() => namespaces["remote.agentPresets"]);
				const nested = readTransportFace(() => scoped.remote?.agentPresets);
				remotePresets = dotted ?? nested;
				onRemotePresetsReady?.();
				return () => {
					remotePresets = void 0;
				};
			});
			const presetTransports = {
				connectionApi: readTransportFace(() => ctx.get("connection")?.api?.agentPresets),
				get remote() {
					return remotePresets;
				}
			};
			const mountUi = () => {
				if (uiDisposer !== void 0) return;
				const sessions = ctx.get("sessions");
				const workspaces = ctx.get("workspaces");
				const controller = new BoardController({
					store: new LocalStorageTaskStore(),
					transport: new HttpTaskBoardHostTransport(),
					sessions: {
						list: sessions.list,
						open: (id) => sessions.open(id)
					}
				});
				controller.start();
				const disposers = [];
				const onVisibilityChange = () => {
					controller.setDocumentVisible(document.visibilityState === "visible");
				};
				document.addEventListener("visibilitychange", onVisibilityChange);
				controller.setDocumentVisible(document.visibilityState === "visible");
				disposers.push(() => {
					document.removeEventListener("visibilitychange", onVisibilityChange);
				});
				const pushWorkspaceOptions = () => {
					const snapshot = workspaces.list.getSnapshot();
					controller.setExecutionOptions({ workspaces: snapshot.items.map((item) => ({
						workspaceId: item.workspaceId,
						title: item.title !== "" ? item.title : item.path
					})) });
				};
				pushWorkspaceOptions();
				disposers.push(workspaces.list.subscribe(pushWorkspaceOptions));
				let reportedPresetFailure;
				const pushPresetOptions = async () => {
					const read = await readPresetRoster(presetTransports);
					if (!read.ok) {
						const key = presetRosterFailureKey(read);
						if (key !== reportedPresetFailure) {
							reportedPresetFailure = key;
							if (read.error === void 0) console.error(`[dsh-task-board] ${formatPresetRosterFailure(read)}`);
							else console.error(`[dsh-task-board] ${formatPresetRosterFailure(read)}`, read.error);
						}
						return;
					}
					reportedPresetFailure = void 0;
					controller.setExecutionOptions({ presets: read.presets });
				};
				pushPresetOptions();
				disposers.push(ctx.on("connection/reset", () => {
					pushPresetOptions();
				}));
				onRemotePresetsReady = () => {
					pushPresetOptions();
				};
				disposers.push(() => {
					onRemotePresetsReady = void 0;
				});
				try {
					disposers.push(mountSidebarEntry(controller));
					disposers.push(mountBoard(controller));
				} catch (error) {
					console.error("[dsh-task-board] mount failed:", error);
				}
				uiDisposer = () => {
					for (const dispose of disposers.splice(0)) dispose();
					controller.dispose();
					uiDisposer = void 0;
				};
			};
			const syncEnabled = () => {
				const snapshot = settingsScope?.getSnapshot();
				if (snapshot === void 0 ? true : snapshot.status === "ready" ? snapshot.value?.enabled ?? true : snapshot.status === "unavailable") mountUi();
				else uiDisposer?.();
			};
			/**
			* Attach the settings card to whichever scope arrived first.
			* @param scope - a settings scope for this plugin's namespace.
			*/
			const attachSettingsCard = (scope) => {
				if (settingsScope !== void 0) return;
				settingsScope = scope;
				settingsCard = new TaskBoardSettingsCardController(scope);
				scope.subscribe(syncEnabled);
				syncEnabled();
			};
			ctx.inject(["configForms"], (scopeCtx) => {
				const forms = scopeCtx.configForms;
				if (forms === void 0 || typeof forms.get !== "function") {
					console.warn("[dsh-task-board] configForms service present but unusable; settings card stays off");
					return;
				}
				attachSettingsCard(forms.get(TASK_BOARD_ENTRY_ID));
			});
			ctx.inject(["settingsScope"], (scopeCtx) => {
				const legacy = scopeCtx;
				const binder = ctx.get("webUiSettings") ?? legacy.settingsScope;
				if (binder === void 0 || typeof binder.bind !== "function") return;
				attachSettingsCard(binder.bind({ namespace: TASK_BOARD_LEGACY_NS }));
			});
			syncEnabled();
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map