import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const CODEX_SESSION_ID_PREFIX = 'ses_cdx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const toPublicId = (id) => `${CODEX_SESSION_ID_PREFIX}${id}`;
export const fromPublicId = (value) => { const parsed = z.string().safeParse(value); if (!parsed.success) return null; const id = parsed.data; return id.startsWith(CODEX_SESSION_ID_PREFIX) && UUID.test(id.slice(CODEX_SESSION_ID_PREFIX.length)) ? id.slice(CODEX_SESSION_ID_PREFIX.length) : null; };
export const isCodexSessionId = (id) => fromPublicId(id) !== null;
export const messageId = (id) => id.startsWith('msg_') ? id : `msg_cdx${Buffer.from(id).toString('hex')}`;
export const tokensOf = (usage) => ({ input: Math.max(0, (usage?.inputTokens || 0) - (usage?.cachedInputTokens || 0)), output: usage?.outputTokens || 0, reasoning: usage?.reasoningOutputTokens || 0, cache: { read: usage?.cachedInputTokens || 0, write: usage?.cacheWriteInputTokens || 0 } });
const spawnSourceSchema = z.object({ subAgent: z.object({ thread_spawn: z.object({ parent_thread_id: z.uuid(), agent_path: z.string().nullable().optional(), agent_nickname: z.string().nullable().optional(), agent_role: z.string().nullable().optional() }) }) });
const spawnSource = (thread) => { const parsed = spawnSourceSchema.safeParse(thread.source); return parsed.success ? parsed.data.subAgent.thread_spawn : null; };
export const parentThreadIdOf = (thread) => z.uuid().safeParse(thread.parentThreadId).success ? thread.parentThreadId : spawnSource(thread)?.parent_thread_id || null;

export const toSession = (thread, { project, metadata = {}, archivedAt, selection = {} } = {}) => {
  const directory = project?.worktree || thread.cwd;
  const codex = { ...metadata.codex, ...selection, directory: thread.cwd, model: thread.model || selection.model || metadata.codex?.model || '', effort: thread.reasoningEffort || selection.effort || metadata.codex?.effort };
  if (Object.hasOwn(thread, 'mode')) codex.mode = thread.mode;
  const source = spawnSource(thread);
  if (source?.agent_path) codex.agentPath = source.agent_path;
  if (thread.agentNickname || source?.agent_nickname) codex.agentNickname = thread.agentNickname || source.agent_nickname;
  if (thread.agentRole || source?.agent_role) codex.agentRole = thread.agentRole || source.agent_role;
  codex.contextWindow = thread.contextWindow || null;
  codex.context = thread.context || null;
  const session = {
    id: toPublicId(thread.id),
    projectID: project?.id || 'global', location: { directory },
    title: thread.name || thread.preview || 'Untitled session', agent: 'codex',
    model: { providerID: 'codex', id: codex.model }, cost: 0, tokens: tokensOf(),
    time: { created: thread.createdAt * 1000, updated: thread.updatedAt * 1000 },
    metadata: { ...metadata, backend: 'codex', codex },
  };
  const parentId = parentThreadIdOf(thread);
  if (parentId) session.parentID = toPublicId(parentId);
  if (thread.cwd && thread.cwd !== directory) session.subpath = thread.cwd.slice(directory.length + 1);
  if (archivedAt) session.time.archived = archivedAt;
  return session;
};

const toolNames = { commandExecution: 'shell', fileChange: 'edit', mcpToolCall: 'mcp', dynamicToolCall: 'tool', collabAgentToolCall: 'task', webSearch: 'websearch', imageView: 'read', imageGeneration: 'image', functionCallOutput: 'tool', sleep: 'sleep', subAgentActivity: 'task' };
export const contentOf = (item, created, completed, childThreadIds = new Set()) => {
  if (item.type === 'agentMessage' || item.type === 'plan') return { type: 'text', text: item.text || '' };
  if (item.type === 'reasoning') return { type: 'reasoning', text: [...(item.summary || []), ...(item.content || [])].join('\n') };
  if (!toolNames[item.type]) return null;
  const collaboration = item.type === 'collabAgentToolCall';
  const activity = item.type === 'subAgentActivity';
  const receivers = activity ? [item.agentThreadId] : item.receiverThreadIds || [];
  const childIds = receivers.filter((id) => childThreadIds.has(id));
  if (activity && !childIds.length) return null;
  const subagent = childIds.length > 0;
  const name = subagent ? 'subagent' : item.type === 'mcpToolCall' ? `${item.server}.${item.tool}` : item.tool || toolNames[item.type];
  const input = subagent ? { agent: item.model || 'codex', description: item.agentPath || item.tool || item.kind, prompt: item.prompt || '' } : collaboration ? { content: item.prompt || '', description: item.description || '' } : item.type === 'commandExecution' ? { command: item.command, cwd: item.cwd } : item.type === 'fileChange' ? { changes: item.changes } : item.arguments || { ...item };
  const failed = ['failed', 'declined', 'cancelled', 'interrupted'].includes(item.status) || item.success === false;
  const settled = completed !== undefined || ['completed', 'failed', 'declined', 'cancelled'].includes(item.status);
  const output = item.aggregatedOutput ?? (item.result ? JSON.stringify(item.result) : item.output ? JSON.stringify(item.output) : item.changes ? item.changes.map((change) => change.diff || '').join('\n') : '');
  const metadata = item.type === 'fileChange' ? { diff: output, changes: item.changes } : {};
  if (subagent) {
    const sessionIDs = [...new Set(childIds.filter((id) => z.uuid().safeParse(id).success).map(toPublicId))];
    if (sessionIDs.length) { metadata.sessionID = sessionIDs[0]; metadata.sessionIDs = sessionIDs; }
    metadata.codex = { operation: item.tool || item.kind, agentsStates: Object.fromEntries(Object.entries(item.agentsStates || {}).filter(([id]) => childThreadIds.has(id))) };
  }
  const state = failed
    ? { status: 'error', input, error: { type: 'ToolError', message: item.error?.message || output || `Codex ${item.status}` }, metadata }
    : settled ? { status: 'completed', input, content: [{ type: 'text', text: output }], metadata } : { status: 'running', input, metadata };
  const time = { created, ran: created };
  if (settled) time.completed = completed ?? created;
  return { type: 'tool', id: item.id, name, executed: true, state, time };
};

/** One upstream item owns one message, for identical identities in history and live. */
export const toMessage = (entry, thread, turn = null, childThreadIds = new Set()) => {
  const item = entry.item;
  const nativeCreated = entry.startedAtMs ?? (turn?.startedAt ?? thread.createdAt) * 1000;
  const created = entry.createdAtMs ?? nativeCreated;
  const nativeCompleted = entry.completedAtMs ?? (turn?.completedAt ? turn.completedAt * 1000 : undefined);
  const completed = nativeCompleted === undefined ? undefined : Math.max(created, nativeCompleted + created - nativeCreated);
  const id = messageId(item.clientId || item.id);
  if (item.type === 'userMessage') {
    const files = (item.content || []).filter((part) => part.type === 'image' || part.type === 'localImage').map((part) => ({ mime: 'image/*', source: { type: 'uri', uri: part.url || `file://${part.path}` } }));
    const message = { type: 'user', id, time: { created }, text: (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n') };
    if (files.length) message.files = files;
    return message;
  }
  if (item.type === 'contextCompaction') return { type: 'compaction', id, time: { created }, status: 'completed', reason: 'auto', summary: '', recent: '' };
  const content = contentOf(item, created, completed, childThreadIds);
  if (!content) return null;
  const message = { type: 'assistant', id, time: { created }, agent: 'codex', model: { providerID: 'codex', id: thread.model || '' }, content: [content], cost: 0, tokens: tokensOf() };
  if (entry.createdAtMs !== undefined) message.metadata = { codex: { timing: { startedAtMs: entry.startedAtMs ?? null, completedAtMs: entry.completedAtMs ?? null } } };
  if (completed !== undefined) { message.time.completed = completed; message.finish = turn?.status === 'failed' ? 'error' : turn?.status === 'interrupted' ? 'interrupted' : 'stop'; }
  return message;
};

export const createWire = (publishEvent) => {
  const emit = (type, thread, data, created = Date.now()) => {
    const id = `evt_cdx${randomUUID().replaceAll('-', '')}`;
    const payload = { id, type, created, data };
    if (thread?.cwd) payload.location = { directory: thread.cwd };
    publishEvent?.({ payload, directory: thread?.cwd, eventId: id });
  };
  return { emit };
};
