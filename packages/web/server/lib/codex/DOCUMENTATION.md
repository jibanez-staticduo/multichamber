# Codex engine

This module adapts the official Codex app-server protocol to the session HTTP
and OpenCode 2 event contracts. It owns Codex transport, thread lifecycle,
message conversion and outstanding approvals. Server integration owns the
merged engine lists, archive overlay and durable Multichamber metadata.

## Authority and transport

The default connects to the existing control socket at
`$CODEX_HOME/app-server-control/app-server-control.sock`, with `~/.codex` as the
home fallback. `MULTICHAMBER_CODEX_SOCKET` selects another existing socket.
An absent socket makes the engine unavailable before its first connection.
Read failures and a missing socket after a successful connection reject. They
never become authoritative empty history or idle status.

`MULTICHAMBER_CODEX_TRANSPORT` selects `unix`, `proxy` or `stdio`. Unix uses a
WebSocket with compression disabled. The Windows default is `proxy`, which
runs `codex app-server proxy --sock ...` and transports WebSocket handshake
bytes and frames through its standard streams. It does not launch another
authority. Windows needs an existing compatible socket and Codex executable.
`MULTICHAMBER_CODEX_BINARY` chooses that executable.

`stdio` explicitly starts a managed `codex app-server --listen stdio://`.
Configure an independent `CODEX_HOME` if the machine already has an authority.
The module never selects this fallback automatically. Disposal closes its own
connection and waits for its own subprocess to exit. It never stops the shared
daemon. `MULTICHAMBER_CODEX_DISABLED=1` turns the engine off.

## Session contracts

Public IDs are `ses_cdx` followed by the native UUID. Routes recognize that
prefix before any history lookup and never send its operations to OpenCode.
Thread APIs own native history, titles, model/effort, archive state and forks.
Multichamber metadata is persisted only through injected metadata callbacks.
No transcript files are modified directly.

`createCodexSurface` provides registration, session/active/pending lists,
queue delivery, announcements, native archive operations and disposal. Its
declaration is in `routes.d.ts`. Refreshing projects on each list/detail keeps
project grouping consistent with current settings. The shared archive handler
must call `archiveSession(publicId, archived)` before its archive overlay write.

Every native item has one deterministic message ID. History and live events
use that same ID; text and reasoning use ordinal zero within their message,
and tools retain their native call IDs. Echoed client message IDs retain their
`msg_` identity. History pages are read through official paginated APIs, and
incomplete history or repeated cursors fail explicitly.

Message chronology follows ascending native item history across every turn
and page. Turn summaries supply the fallback start time; item entries supply
their recorded millisecond timestamps. Equal, missing or backward timestamps
advance by one logical millisecond from the preceding item. These increments
encode native order, not measured execution duration. They keep the shared
UI's timestamp comparator from ordering a prompt after its response by ID.
Completion moves by the same logical offset as creation, preserving the
recorded duration when native times exist and never producing a negative
duration. Exact recorded item times remain in `metadata.codex.timing`.
Live inbox and assistant-start events carry those same creation times. The
current turn's item times are retained for duplicate events and cleared at
the next turn or disconnect. Rehydration recomputes them from native history,
without using the fetch time or changing message IDs.

Session lists set `thread/list.useStateDbOnly` on every page. The native state
database supplies the complete paginated list without scanning rollout JSONL
files to repair metadata on each request. Missing or failed database reads
reject the list. They never fall back to a full rollout scan or empty success.

Subagent sessions use the native `parentThreadId` or persisted
`source.subAgent.thread_spawn.parent_thread_id` relationship. Source nickname,
role and path remain in `metadata.codex`. The child list route
`GET /api/session?parentID=ses_cdx...` uses the native database parent filter,
returns the common paged session shape and never reads child transcripts.
Native child-start notifications announce the same parent and project mapping
as HTTP reads. Collaboration and activity items project to `subagent` only
for authoritative direct children. Spawn operations identify their new children;
other recipients are checked through native metadata, once per distinct unknown
recipient in a history read. Opening a thread hydrates its direct child summaries
for live events. Child tools carry `metadata.sessionID` and `metadata.sessionIDs`.
Messages to parents, peers or the same thread remain ordinary operation tools
with the sent text in `input.content`, without task links or recipient activity.
Nonchild activity records carry no message text and are omitted. No relationship
is inferred from task paths, prompts or recipient output.

Codex 0.163 can omit collaboration call arguments from its item API while
retaining only activity markers. For the opened thread only, `communications.js`
reads the authoritative `thread/read.path` as newline JSON and recovers the
allowlisted `collaboration.send_message`, `send_input` and `followup_task` call
arguments. The exact sent message is `input.content`; its native target is the
description. Native call IDs deduplicate and enrich matching official activity
records. Output bodies are never projected, only completion status.

The reader streams the file once, then reads only appended complete lines.
An incomplete writer tail waits for the next read. No directories or other
transcripts are scanned, and the reader never writes native files. Live recovery
is triggered by interaction/turn events for an opened subscription, coalescing
overlapping triggers and publishing each start/completion once. A history
recovery failure rejects the HTTP history request so clients retain their prior
snapshot. Detail and live recovery failures log a diagnostic without falsely
settling the running turn. A missing native path means recovery is unavailable.

On the affected NAS thread, a 4,652,812-byte transcript yielded 44 communications
in 152 ms cold and 0.49 ms warm without printing their content. These are local
reader measurements, not a claim about device rendering performance.

Codex omits some loaded, empty-preview children from its global list. The
adapter checks the loaded IDs missing from that list with metadata-only reads,
then classifies each child's archive and search state with one native parent
query per affected parent. Only those missing loaded children are added.
Unloaded hidden children are discovered when their parent is expanded. Failed
classification rejects the global list rather than guessing archive state.

Reading a session resumes the native subscription without changing its
settings. Starting a turn first reads authoritative live status and refuses an
active thread. Concurrent starts on this connection are refused.
New sessions default to full access with `danger-full-access` and `never`
approvals. The read-only and workspace modes keep on-request approvals.
Continuing an existing session without an explicit mode selection sends no
sandbox or approval overrides, preserving Codex's native configuration.
Model and mode changes refuse busy threads.
Synthetic context is consumed on acceptance and restored after a refusal.

An explicit `delivery: 'steer'` targets the authoritative in-progress turn with
`turn/steer.expectedTurnId`; text and image input follow the same native input
parser. It never resumes the thread or changes its model/sandbox mid-turn.
Resume responses report effective sandbox and approval policy. Recognized
policy pairs produce a displayed mode; custom combinations remain unknown,
independently of new-session defaults.

Catalog and create defaults resolve saved Multichamber preferences before the
effective native `config/read` model and effort. New-session sandbox defaults
stay explicit and do not rewrite the shared native configuration. Numeric
`token_count` usage is recovered in the same authoritative transcript read and
attached once to the last assistant record per turn. Cached input is separated
from uncached input. `metadata.codex.usageAvailable` marks verified accounting;
missing usage is unknown and cannot authorize a budgeted goal to continue.
Live billing uses the native cumulative total minus the captured turn baseline,
so multiple model round trips and repeated usage notifications count once.
`metadata.codex.usageScope: 'turn'` identifies these aggregates in history and
live events; they cannot be divided by the last text message's duration to
claim a response rate.

Context occupancy is a separate native measurement. The last response's
`last_token_usage.total_tokens` and `model_context_window` populate
`metadata.codex.context = { state: 'measured', tokens, window }`; accumulated
billing and per-turn Goals tokens never determine this percentage. Compaction
changes it to `{ state: 'compacted', window }` until Codex reports a new last
response. Unknown windows remain null, without a guessed model fallback.
History hydration and `thread/tokenUsage/updated` live events use the same
contract, and live updates announce the complete session metadata.

## Supported operations

History, create/resume, text and image prompts, text/reasoning/tool events,
command/edit approvals, non-secret questions, interrupt, rename, delete,
archive/restore, compaction and whole-thread forks use official RPC methods.
Images accept the composer contract `{uri, name}`. Supported image data URIs
and HTTP/file URLs with image extensions are accepted; other attachments are
refused. Model catalogs report upstream reasoning-effort support.

Forking before an individual message, commands, arbitrary shell execution,
share links, file rewind and conversation revert are explicitly unsupported.
The engine does not expose Codex account sign-in, native verification,
permission profile grants, arbitrary dynamic client tools or MCP elicitations.
Unsupported server requests fail closed. Unknown command/edit approvals are
declined; unsupported elicitation requests are declined; secret questions are
cancelled. Pending asks disappear on disconnect or turn completion.

## Policy and runtime parity

Codex is an additional provider route outside OpenCode's configured providers.
Enterprise mode blocks all Codex HTTP actions, queue sends and lists at the
server boundary. Existing asks are denied when policy is observed to change,
and new approval requests check policy before publication. UI visibility is
not authorization. No new listener or credential store is created.

Web, Electron, hosted mobile and Capacitor mobile use the same authenticated
server routes and existing event transport. Local binaries and socket paths
belong to the server, never the browser. The VS Code extension is outside this
integration's scope. There is no new browser WebSocket endpoint or change to
the relay wire protocol.

## Evidence

The protocol was checked against `codex-cli 0.163.0` generated bindings.
Focused tests exercise HTTP body fidelity and bounds, enterprise refusal,
history failures, active status, concurrency, approval ownership, disconnects,
image inputs and the shared UI's `translateWireEvent` consumer. Transport
tests use isolated Unix sockets and the installed Codex proxy executable.
`runtime.integration.test.js` starts a temporary `CODEX_HOME` and a loopback
Responses SSE fixture. Express routes drive the real app-server through create,
detail, prompt, history, rename, fork, archive/restore, and delete. The test
compares user and assistant message IDs between HTTP responses, translated live
events, and history.
The real-binary cases skip when Codex is not installed. No inference against
an external provider, existing thread mutation, Windows, macOS or mobile device
was validated here.
