# Agent parity: OpenCode, Claude Code, and Codex

One row per feature a session can be asked for. Source of truth is `ENGINES` in
`packages/web/server/lib/engines/engines.js` (served at `GET /api/engines`, mirrored by
`SESSION_ENGINE_INFO` in `packages/ui/src/lib/sessionEngine.ts`). The `parity` tests
(`packages/ui/src/lib/parity.test.ts`, `packages/web/server/lib/engines/engines.test.js`) fail when this table
and the declarations disagree, and when a `GAP` has no reason.

`OK` = the engine does it. `GAP` = the engine does not; the reason is in the last column. A `GAP` is answered by the
server with `UnsupportedOperationError` and hidden in the UI; it is never forwarded to the other engine.

| Feature | OpenCode | Claude | Codex | Estado | Motivo |
| --- | --- | --- | --- | --- | --- |
| `prompt` | yes | yes | yes | OK |  |
| `interrupt` | yes | yes | yes | OK |  |
| `rename` | yes | yes | yes | OK |  |
| `delete` | yes | yes | yes | OK |  |
| `archive` | yes | yes | yes | OK |  |
| `synthetic` | yes | yes | yes | OK |  |
| `fork` | yes | yes | yes | OK |  |
| `forkAtMessage` | yes | yes | no | GAP | Motivo: Codex forks at turn boundaries, not arbitrary messages. |
| `compact` | yes | yes | yes | OK |  |
| `shell` | yes | no | no | GAP | Motivo: Claude Code records no shell run in its transcript, so there is nothing to show or replay. Motivo: this Codex integration does not expose this operation. |
| `revert` | yes | no | no | GAP | Motivo: the transcript lives in Claude Code's own files, tied to its directory; there is nothing to stage a revert on. Motivo: this Codex integration does not expose this operation. |
| `move` | yes | no | no | GAP | Motivo: a Claude Code transcript is tied to the directory it runs in; it cannot move to another one. Motivo: this Codex integration does not expose this operation. |
| `generate` | yes | no | no | GAP | Motivo: Claude Code has no side generation (titles, summaries) endpoint to call. Motivo: this Codex integration does not expose this operation. |
| `diff` | yes | no | no | GAP | Motivo: turn diffs come from OpenCode snapshots; Claude Code keeps none to diff. Motivo: this Codex integration does not expose this operation. |
| `permissions` | yes | yes | yes | OK | Claude tool prompts and Codex approvals are served as common permission requests. |
| `forms` | yes | yes | yes | OK | Claude questions and Codex user-input requests are served as common form requests. |
| `metadata` | yes | yes | yes | OK | Pins, `/btw` links and the knowledge cursor live in Multichamber's own store. |
| `goals` | yes | yes | yes | OK | Goals continue through the owning harness and use its authoritative activity and usage. |
| `models` | providers | catalog | catalog | OK | OpenCode uses providers; Claude and Codex use their own model catalogs. |
| `agents` | agents | modes | modes | OK | OpenCode uses agents; Claude and Codex expose their own permission modes. |
| `commands` | server | prompt | none | GAP | OpenCode runs the template; Claude receives `/name args` and expands it itself. Motivo: Codex commands are not exposed through this integration. |

## Adding an engine

An engine is one entry in `ENGINES`, one in `SESSION_ENGINE_INFO` (the type is exported as `AgentProvider`) and a
`server/lib/<engine>/` module with its routes. Add its column here; the `parity` tests enforce the rest. Codex uses its own app-server threads through `server/lib/codex`, with public IDs prefixed `ses_cdx`. Its model and permission controls read `/api/codex/models`; a host must declare Codex available before creation is offered.
