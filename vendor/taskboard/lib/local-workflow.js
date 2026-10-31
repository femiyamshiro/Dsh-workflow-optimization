// Local derivative: reuse the upstream Host, ledger and native command registry.
import { randomUUID } from 'node:crypto';

export function executionPrompt(task) {
  const prompt = task.prompt !== '' ? task.prompt : task.title;
  const notes = task.description?.trim();
  return notes ? `${prompt}\n\n[任务卡补充说明与验收反馈]\n${notes}` : prompt;
}

export function executionState(ctx, sessionId) {
  try {
    const service = ctx.get('jobs');
    if (typeof service?.list !== 'function') return { settled: undefined, jobs: [] };
    const jobs = service.list(sessionId);
    if (!Array.isArray(jobs) || jobs.some(job => job.owner !== sessionId ||
      !['running', 'stopping', 'completed', 'killed', 'failed'].includes(job.status))) {
      return { settled: undefined, jobs: [] };
    }
    return { settled: !jobs.some(job => ['running', 'stopping'].includes(job.status)),
      jobs: jobs.map(({ id, status, detail }) => ({ id, status, detail })) };
  } catch { return { settled: undefined, jobs: [] }; }
}

const HELP = `/board list\n/board new 标题 | 执行要求\n/board show <任务ID或唯一前缀>\n/board run <ID>\n/board note <ID> <补充说明>\n/board reject <ID> <反馈>\n/board confirm <ID>\n卡片 review 表示等待人工验收，不表示业务检查已通过。`;

export function boardCommand(ctx, host) {
  return {
    name: 'board', description: '任务看板：创建、执行、反馈与人工验收',
    input: { hint: 'list | new 标题 | 要求 | show/run/note/reject/confirm <ID>' },
    recordInput: false,
    async handler({ rawInput, agent, signal }) {
      try {
        signal.throwIfAborted();
        const match = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(rawInput);
        const verb = match?.[1] ?? 'help'; const rest = match?.[2] ?? '';
        const tasks = host.snapshot().tasks.filter(task => task.archivedAt === undefined);
        if (verb === 'help') return { kind: 'success', text: HELP };
        if (verb === 'list') return { kind: 'success', text: tasks.map(task =>
          `${task.id}  ${task.status}  ${task.title}`).join('\n') || '暂无任务。' };
        if (verb === 'new') {
          const divider = rest.indexOf('|');
          const title = rest.slice(0, divider).trim(); const prompt = rest.slice(divider + 1).trim();
          if (divider < 0 || !title || !prompt) throw Error('用法：/board new 标题 | 执行要求');
          const workspace = ctx.get('workspaceController');
          if (typeof workspace?.create !== 'function') throw Error('原生工作区服务不可用，未创建任务。');
          const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session });
          if (!['read-only', 'workspace-write', 'danger-full-access'].includes(policy?.mode)) {
            throw Error('当前会话权限无法确认，未创建任务。');
          }
          const directory = ctx.get('workingDirectory');
          if (typeof directory?.ensure !== 'function') throw Error('当前工作目录服务不可用，未创建任务。');
          const cwd = await directory.ensure(agent, signal);
          const result = await workspace.create({ path: cwd });
          signal.throwIfAborted();
          const workspaceId = result?.workspace?.workspaceId;
          if (!workspaceId) throw Error('原生工作区未返回身份，未创建任务。');
          const id = randomUUID();
          host.apply(randomUUID(), { kind: 'create', id, input: { title, prompt, description: '',
            kind: 'once', workspaceId, permission: policy.mode } });
          return { kind: 'success', text: `已创建 ${id}\n工作区：${cwd}\n权限：${policy.mode}\n执行：/board run ${id}` };
        }
        if (!['show', 'run', 'note', 'reject', 'confirm'].includes(verb)) throw Error(HELP);
        const parts = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
        if (!parts) throw Error('缺少任务ID。');
        const exact = tasks.find(task => task.id === parts[1]);
        const hits = exact ? [exact] : tasks.filter(task => parts[1].length >= 6 && task.id.startsWith(parts[1]));
        if (hits.length !== 1) throw Error(hits.length ? '任务ID前缀不唯一。' : '任务不存在，或前缀少于6字符。');
        const task = hits[0]; const text = parts[2]?.trim();
        const sid = task.executions.at(-1)?.sessionId;
        if (verb === 'show') return { kind: 'success', text: JSON.stringify({ ...task,
          runtime: sid ? executionState(ctx, sid) : undefined,
          acceptance: 'review仅是人工验收入口；需核对产物和项目检查。',
          resume: sid ? `/resume ${sid}` : undefined }, null, 2) };
        if (['note', 'reject'].includes(verb) && !text) throw Error('补充说明/反馈不能为空。');
        if (!['note', 'reject'].includes(verb) && text) throw Error('此操作不接受额外文字。');
        const action = verb === 'note' ? { kind: 'update', taskId: task.id,
          patch: { description: task.description ? `${task.description}\n\n${text}` : text } }
          : verb === 'reject' ? { kind: 'reject', taskId: task.id, note: text }
          : { kind: verb, taskId: task.id };
        host.apply(randomUUID(), action);
        return { kind: 'success', text: `${verb} 已受理：${task.id}\n/board show ${task.id}` };
      } catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) }; }
    },
  };
}
