import { z } from 'zod';
import { runtimeFetch } from '../runtime-fetch';
import { projectSession } from './projection';

export type NativeHarness = 'claude' | 'codex';
const jsonObject = z.record(z.string(), z.json());
const tokens = z.object({ input: z.number(), output: z.number(), reasoning: z.number(), cache: z.object({ read: z.number(), write: z.number() }) });
const session = z.object({
  id: z.string(), parentID: z.string().optional(), projectID: z.string(), location: z.object({ directory: z.string() }),
  subpath: z.string().optional(), title: z.string().optional(), agent: z.string().optional(), model: z.object({ providerID: z.string(), id: z.string(), variant: z.string().optional() }).optional(),
  cost: z.number(), tokens, time: z.object({ created: z.number(), updated: z.number(), idle: z.number().optional(), viewed: z.number().optional(), archived: z.number().optional() }), metadata: jsonObject.optional(),
});
const permission = z.object({ id: z.string(), sessionID: z.string(), action: z.string(), resources: z.array(z.string()), save: z.array(z.string()).optional(), metadata: jsonObject.optional(), message: z.string().optional() });
const option = z.object({ value: z.string(), label: z.string(), description: z.string().optional() });
const fieldBase = { key: z.string(), title: z.string().optional(), description: z.string().optional(), required: z.boolean().optional(), hidden: z.boolean().optional() };
const field = z.discriminatedUnion('type', [
  z.object({ ...fieldBase, type: z.literal('string'), options: z.array(option).optional(), custom: z.boolean().optional(), default: z.string().optional() }),
  z.object({ ...fieldBase, type: z.literal('multiselect'), options: z.array(option), custom: z.boolean().optional(), default: z.array(z.string()).optional() }),
  z.object({ ...fieldBase, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.object({ ...fieldBase, type: z.literal('number'), default: z.number().optional() }),
  z.object({ ...fieldBase, type: z.literal('integer'), default: z.number().optional() }),
  z.object({ key: z.string(), type: z.literal('external'), url: z.string(), title: z.string().optional(), description: z.string().optional() }),
]);
const form = z.object({ id: z.string(), sessionID: z.string(), title: z.string(), metadata: jsonObject.optional(), fields: z.tuple([field], field) });
const active = z.record(z.string(), z.object({ type: z.enum(['busy', 'retry']) }));

async function read(harness: NativeHarness, resource: string, signal: AbortSignal) {
  const response = await runtimeFetch(`/api/harnesses/${harness}/${resource}`, { signal });
  if (!response.ok) throw new Error(`${harness} ${resource} unavailable (${response.status})`);
  return response.json();
}

export const readNativeHarnessSessions = async (harness: NativeHarness, signal: AbortSignal) =>
  z.object({ harness: z.literal(harness), data: z.array(session) }).parse(await read(harness, 'sessions', signal)).data.map(projectSession);
export const readNativeHarnessActive = async (harness: NativeHarness, signal: AbortSignal) =>
  z.object({ harness: z.literal(harness), data: active }).parse(await read(harness, 'active', signal)).data;
export const readNativeHarnessPermissions = async (harness: NativeHarness, signal: AbortSignal) =>
  z.object({ harness: z.literal(harness), data: z.array(permission) }).parse(await read(harness, 'pending/permission', signal)).data;
export const readNativeHarnessForms = async (harness: NativeHarness, signal: AbortSignal) =>
  z.object({ harness: z.literal(harness), data: z.array(form) }).parse(await read(harness, 'pending/form', signal)).data;
