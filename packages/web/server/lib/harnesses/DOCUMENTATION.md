# Harness Management

## Ownership

This module reports installed runtime versions, update ownership and effective
session defaults for OpenCode, Claude Code and Codex. Native session modules
retain lifecycle, permission and transport ownership. App update distribution
belongs to the package manager and fork update modules.

Web, Electron, hosted mobile and Capacitor use the same authenticated API. CLI
paths, native configuration and update commands stay on the server. No listener,
account credential store or shared daemon restart is introduced here.

## Invariants

- `/api/harnesses` reports one entry per harness. A failed version/catalog read
  is an explicit `checkError`, never evidence that an installed CLI disappeared.
- Version means the selected installed executable's version. A shared Codex
  daemon may keep its older executable until its owner deliberately restarts it.
- Update checks fetch official package metadata. Updating requires confirmation,
  known installation ownership and no active session. Unknown/package-owned,
  bundled or shared installations receive a manual action and reason.
- The server invokes fixed executable/argument arrays with `windowsHide` and
  closed stdin. Client-provided commands never reach a shell.
- Session defaults use app preferences, then native configuration, then the
  harness catalog. Codex new sessions default to full access; existing sessions
  preserve native permissions unless the user changes them.
- `defaultHarness` and native model/effort/mode settings persist through the
  shared settings registry. Explicit choices are validated; empty strings clear
  app overrides and do not require a provider call.
- `session-client.js` routes supported reads and synthetic context to the native
  owner by public ID. Unsupported native mutations fail before an OpenCode call.
- Independent `/api/harnesses/:id/sessions`, `/active` and `/pending/:kind`
  snapshots describe only that native engine. They never imply that OpenCode's
  global list is empty while its backend is unavailable.

## Decisions

### Why Manual Updates For Shared Codex

An app-server belongs to existing sessions and can have a different lifetime
from the web app. Updating or restarting it automatically would interfere with
work owned by another client. The API reports the native install action instead.

### Why Native Read Adapters

Search indexing, scheduled existing-session validation, session assistance and
work classification use the same native records as the visible conversation.
They do not invent OpenCode sessions for native IDs. Native events enter the hub
only after these readers resolve ownership. The goal runtime owns continuation
coverage, including native continuation and available token accounting. Cache warming is an OpenCode capability and native events do not
trigger an OpenCode warming request.

### Why Instruction Entries Stay With The Native Send

Project notes and plans synchronize to native instruction entries and are
prepended to the next native prompt. Queue delivery already carries knowledge,
so the adapter avoids adding a second copy. Obligatory pinned conversation
context uses the native synthetic-context path.

Queued scheduled work carries its captured model and effort into the owning
native send. A mismatched provider or unsupported catalog choice is refused
before execution instead of silently using a later composer selection.
