import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const envelopeSchema = z.object({ timestamp: z.string(), type: z.string(), payload: z.json() });
const contextSchema = z.object({ turn_id: z.string() });
const callSchema = z.object({ type: z.literal('function_call'), namespace: z.literal('collaboration'), name: z.enum(['send_message', 'send_input', 'followup_task']), call_id: z.string().min(1), arguments: z.string() });
const argsSchema = z.object({ target: z.string(), message: z.string() });
const outputSchema = z.object({ type: z.literal('function_call_output'), call_id: z.string() });
const relevantCallSchema = z.object({ type: z.literal('function_call'), namespace: z.literal('collaboration'), name: z.enum(['send_message', 'send_input', 'followup_task']) });
const tokenUsageSchema = z.object({ type: z.literal('token_count'), info: z.object({ total_token_usage: z.object({ input_tokens: z.number(), cached_input_tokens: z.number(), cache_write_input_tokens: z.number().optional(), output_tokens: z.number(), reasoning_output_tokens: z.number() }), last_token_usage: z.object({ total_tokens: z.number().nonnegative() }).optional(), model_context_window: z.number().positive().nullable().optional() }).nullable() });

/** Incremental, read-only recovery for communication args omitted by Codex v2. */
export const createCommunicationReader = () => {
  const states = new Map();
  const read = async (thread) => {
    if (!thread.path) return [];
    if (!path.isAbsolute(thread.path)) throw new Error('Codex returned an invalid transcript path');
    let state = states.get(thread.id);
    const file = await open(thread.path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Codex transcript is not a regular file');
      if (!state || state.path !== thread.path || state.inode !== stat.ino || stat.size < state.offset) {
        state = { path: thread.path, inode: stat.ino, offset: 0, turnId: null, entries: new Map(), usage: new Map(), contextByTurn: new Map(), context: null, pending: null };
        states.set(thread.id, state);
      }
      if (state.pending) return state.pending;
      const scan = async () => {
        if (stat.size === state.offset) return [...state.entries.values()];
        let consumed = state.offset;
        let buffer = Buffer.alloc(0);
        for await (const chunk of file.createReadStream({ start: state.offset, end: Math.max(state.offset, stat.size - 1), autoClose: false })) {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length > 16 * 1024 * 1024) throw new Error('Codex transcript line is too large');
          let newline;
          while ((newline = buffer.indexOf(10)) >= 0) {
            const line = buffer.subarray(0, newline).toString('utf8');
            buffer = buffer.subarray(newline + 1);
            consumed += Buffer.byteLength(line) + 1;
            if (!line.trim()) { state.offset = consumed; continue; }
            const raw = JSON.parse(line);
            const envelope = envelopeSchema.parse(raw);
            if (envelope.type === 'turn_context') state.turnId = contextSchema.parse(envelope.payload).turn_id;
            if (envelope.type === 'event_msg') { const parsed = contextSchema.safeParse(envelope.payload); if (parsed.success) state.turnId = parsed.data.turn_id; }
            if (envelope.type === 'event_msg' && state.turnId) {
              const usage = tokenUsageSchema.safeParse(envelope.payload);
              if (usage.success && usage.data.info) {
                state.usage.set(state.turnId, usage.data.info.total_token_usage);
                if (usage.data.info.last_token_usage) {
                  state.context = { state: 'measured', tokens: usage.data.info.last_token_usage.total_tokens, window: usage.data.info.model_context_window || null };
                  state.contextByTurn.set(state.turnId, state.context);
                }
              }
            }
            if (envelope.type === 'compacted') state.context = { state: 'compacted', window: state.context?.window || null };
            if (envelope.type === 'response_item') {
              const call = callSchema.safeParse(envelope.payload);
              if (!call.success && relevantCallSchema.safeParse(envelope.payload).success) throw new Error('Malformed Codex communication call');
              if (call.success) {
                const args = argsSchema.parse(JSON.parse(call.data.arguments));
                const timestamp = Date.parse(envelope.timestamp);
                if (!Number.isFinite(timestamp) || !state.turnId) throw new Error('Codex communication is missing its turn or timestamp');
                if (!state.entries.has(call.data.call_id)) state.entries.set(call.data.call_id, { turnId: state.turnId, startedAtMs: timestamp, completedAtMs: null, item: { type: 'collabAgentToolCall', id: call.data.call_id, tool: call.data.name, prompt: args.message, description: args.target, receiverThreadIds: [], status: 'inProgress' } });
              }
              const output = outputSchema.safeParse(envelope.payload);
              const entry = output.success ? state.entries.get(output.data.call_id) : undefined;
              if (entry) { entry.completedAtMs = Date.parse(envelope.timestamp); entry.item.status = 'completed'; }
            }
            state.offset = consumed;
          }
        }
        return [...state.entries.values()];
      };
      state.pending = scan().finally(() => { state.pending = null; });
      return await state.pending;
    } finally { await file.close(); }
  };
  const usage = (id) => {
    const output = new Map();
    let previous = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
    for (const [turnId, current] of states.get(id)?.usage || []) {
      const difference = (key) => Math.max(0, (current[key] || 0) - (previous[key] || 0));
      output.set(turnId, { inputTokens: difference('input_tokens'), cachedInputTokens: difference('cached_input_tokens'), cacheWriteInputTokens: difference('cache_write_input_tokens'), outputTokens: difference('output_tokens'), reasoningOutputTokens: difference('reasoning_output_tokens') });
      previous = current;
    }
    return output;
  };
  const cumulativeUsage = (id) => new Map([...(states.get(id)?.usage || [])].map(([turnId, current]) => [turnId, { inputTokens: current.input_tokens, cachedInputTokens: current.cached_input_tokens, cacheWriteInputTokens: current.cache_write_input_tokens || 0, outputTokens: current.output_tokens, reasoningOutputTokens: current.reasoning_output_tokens }]));
  return { read, usage, cumulativeUsage, context: (id) => states.get(id)?.context || null, contextByTurn: (id) => states.get(id)?.contextByTurn || new Map(), dispose: () => states.clear() };
};
