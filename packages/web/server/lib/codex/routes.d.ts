import type { Readable } from 'node:stream';

export type CodexJson = null | boolean | number | string | CodexJson[] | { [key: string]: CodexJson | undefined };
export interface CodexRouteRequest extends Readable {
  params: { [key: string]: string | string[] };
  query: { [key: string]: string | string[] | undefined };
  path: string;
  method: string;
  body?: CodexJson | Buffer;
  get(name: string): string | undefined;
}
export interface CodexRouteResponse {
  status(code: number): CodexRouteResponse;
  json(value: CodexJson): CodexRouteResponse;
  end(): CodexRouteResponse;
}
export type CodexRouteHandler = (req: CodexRouteRequest, res: CodexRouteResponse, next: () => void) => void | CodexRouteResponse | Promise<void | CodexRouteResponse>;
export interface CodexRouteApp {
  get(path: string, handler: CodexRouteHandler): void;
  post(path: string, handler: CodexRouteHandler): void;
  patch(path: string, handler: CodexRouteHandler): void;
  delete(path: string, handler: CodexRouteHandler): void;
  all(path: string, handler: CodexRouteHandler): void;
}
export interface CodexSession {
  id: string;
  parentID?: string;
  projectID: string;
  location: { directory: string };
  title: string;
  agent: string;
  model: { providerID: string; id: string };
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  time: { created: number; updated: number; archived?: number };
  metadata: { backend: 'codex'; codex: { directory: string; model: string; effort?: string; mode?: string; contextWindow?: number | null; context?: { state: 'measured'; tokens: number; window: number | null } | { state: 'compacted'; window: number | null } | null }; [key: string]: CodexJson | undefined };
}
export interface CodexSurfaceOptions {
  publishEvent?: (event: { payload: CodexJson; directory?: string; eventId: string }) => void;
  readProjects?: () => Promise<Array<{ id: string; worktree: string }>>;
  getArchivedSessions?: () => Promise<{ [id: string]: number | null } | null>;
  getStoredMetadata?: (id: string) => Promise<{ codex?: { model?: string; effort?: string; mode?: string }; [key: string]: CodexJson | undefined } | undefined>;
  peekStoredMetadata?: (id: string) => { [key: string]: CodexJson | undefined } | undefined;
  updateStoredMetadata?: (id: string, patch: { [key: string]: CodexJson | undefined }) => Promise<void>;
  forgetStoredMetadata?: (id: string) => Promise<void>;
  isEnterpriseMode?: () => boolean;
  env?: NodeJS.ProcessEnv;
  readAppSettings?: () => Promise<{ codexDefaultModel?: string; codexDefaultEffort?: string; codexDefaultMode?: string }>;
}
export interface CodexSurface {
  register(app: CodexRouteApp): void;
  listCodexSessions(options?: { directory?: string | null; search?: string | null }): Promise<CodexSession[]>;
  listCodexActive(options?: { directory?: string | null }): Promise<{ [id: string]: { type: string } }>;
  listCodexPending(kind: string, options?: { directory?: string | null }): CodexJson[];
  runtime: { ensureAvailable(): Promise<boolean>; dispose(): Promise<void> };
  sessionClient: {
    get(id: string): Promise<CodexSession>;
    messages(id: string, options?: { order?: string; limit?: number; cursor?: string; type?: string }): Promise<{ data: CodexJson[]; cursor: { previous: string | null; next: string | null } }>;
    synthetic(id: string, text: string): Promise<void>;
    putInstruction(id: string, key: string, text: string): Promise<void>;
    removeInstruction(id: string, key: string): Promise<void>;
    prompt(id: string, body: { text?: string; files?: Array<{ uri: string; mime?: string; name?: string }> }): Promise<{ messageID: string; created: number }>;
    activity(id: string): Promise<{ statuses: { [id: string]: { type: string } }; children: Array<{ id: string; parentID: string }> }>;
  };
  announceSession(id: string): Promise<void>;
  archiveSession(id: string, archived: boolean): Promise<void>;
  getCatalog(directory?: string): Promise<{ models: Array<{ id: string; label?: string; supportedReasoningEfforts: Array<{ reasoningEffort: string; description?: string }>; defaultReasoningEffort: string }>; defaultModelId: string; defaultEffort: string; defaultMode: string; efforts: Array<{ id: string; label: string }>; modes: Array<{ id: string; label: string }> }>;
  queueTransport: { owns(id: string): boolean; isIdle(id: string): Promise<boolean | null>; send(id: string, directory: string, input?: { text?: string; files?: Array<{ uri: string; mime?: string; name?: string }>; context?: string[]; knowledge?: string }): Promise<{ knowledgeDelivered: boolean }> };
  dispose(): Promise<void>;
}
export function isCodexSessionId(id: string): boolean;
export function createCodexSurface(options?: CodexSurfaceOptions): CodexSurface;
