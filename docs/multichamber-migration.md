# Multichamber on official Multichamber main

## Scope

The migration starts at official Multichamber commit
`ad73d11a6e7cafa0880e238f92ba7cf5cf2cb1fd`, version 2.5.0. The previous
fork was based on version 2.1.1. Its current source, including uncommitted
Codex fixes, is preserved separately before porting.

The retained changes are native Claude Code and Codex session support,
engine selection and filtering, their shared session contracts, fork-owned
update sources and web, desktop and mobile distribution. New Codex sessions
start with full access. Resuming an existing session preserves its native
permissions unless the user selects another mode.

Company Office and automatic company filing, Cache Timer, Stream Metrics and
their compositor plugin additions are removed. The official session-assist,
BTW, model picker, archive tabs and mobile presentation replace the inherited
fork customizations. Claude sessions retain manual archive operations without
the fork's seven-day automatic archive rule. The general official SDK and
extension framework remain available, with an empty built-in registry.

VS Code is not a distribution target. Existing shared compatibility adapters
do not constitute a shipped extension.

## Runtime contract

| Runtime | Behavior |
| --- | --- |
| Web | Official shared UI with three engines through the authenticated server. |
| Electron on macOS, Windows and Linux | Shared UI and in-process backend; fork release feeds and native packaging remain platform-owned. |
| Hosted mobile | Shared server engine routes and mobile interface. |
| Capacitor on iOS and Android | Bundled mobile interface connects to the selected server, which owns native engine runtimes. |
| VS Code | No extension, build command or release workflow. |

The engine capability matrix is in [agent parity](agent-parity.md). Features
that require OpenCode-specific operations remain unavailable for engines that
do not implement them. A native engine ID is never forwarded to OpenCode as
a fallback. Failed authoritative reads preserve the client's prior snapshot.

## Acceptance

- Preserve the official 2.5 inbox, model selection, deferred tool content,
  session warming, diagnostics, isolated spaces and runtime transport behavior.
- Validate engine lists, history, active status, metadata, queues, permission
  and question routing through the shared protocol.
- Preserve Codex message order, child relationships and readable messages sent
  to a parent without rendering that parent's activity as a child task.
- Keep update checks, installer archives and native feeds on the fork.
- Check removal of the extra packages and VS Code build dependencies.
- Run combined type checks, lint, relevant tests and builds serially after
  the independently owned ports are complete.
- Check the NAS candidate with copied application state before replacing the
  pilot. Native installers and update handoffs need separate platform QA;
  tests of the earlier 2.1.1 candidate do not verify this migration.

## Recovery

The previous source snapshot is stored outside the repository. Candidate QA
uses a separate application data copy. Existing OpenCode and Codex authorities
remain running; the migration does not rewrite their stored conversations.
Only the Multichamber pilot changes after acceptance. The previous source and
pilot data remain available to restore its prior executable and application
state if a startup or compatibility check fails.

## Validation on 19 October 2026

The combined workspace type check and lint passed. Lint retains one existing
hook-dependency warning in `HtmlRenderFrame.tsx`. Dead-code checking reported
no unused code, with one configuration hint for a mobile glob. The web build,
mobile asset preparation, Electron main bundle and Docker build passed.

The focused backend run passed 406 tests with one Windows case skipped. Its
separate engine-matrix rerun passed 15 tests after adding the matrix document.
Ten isolated UI test files passed, covering engine selection, catalogs, routing,
creation, child navigation, orphan-message rendering and settings snapshots.
The unchanged official SDK passed all 23 test files. A real Codex app-server
turn passed against an isolated local provider and temporary home.

The temporary NAS candidate returned HTTP 200 for existing histories from all
three engines. In the browser, the Codex and Claude creation pickers loaded,
Codex defaulted to Full access, and a Codex child opened from the parent's task
button. Expanding a send operation showed its message without a parent task
or a nested link to that parent. At a 390-pixel viewport, the chat and native
engine controls fit without horizontal overflow. These checks sent no new
prompt to an existing conversation and did not take over a Claude writer.

Activation moved the validated worktree to `/home/staticduo/git/multichamber`.
The previous dirty checkout remains at
`/home/staticduo/git/multichamber-before-20261019`, including its Git metadata.
The pilot resumed on `10.71.14.2:3080`, with all three engines available and
the browser rendering the current Codex history. The existing OpenCode,
Multichamber and shared Codex authority processes were not restarted.

The stricter anti-slop rules report inherited typing debt in the ported engine
code and official shared files. Compared with the exact previous source,
the measured rule counts did not grow. This is not a passing pre-commit gate
against the official-only base; the migration is uncommitted and unpublished.
Native installers, signed releases and actual update installation on each
platform were not validated for this migrated candidate.

## Multi-engine revision on 20 October 2026

Session creation uses the instance's saved engine and native model, effort and
permission defaults. Explicit engine choices change that preference. Source
filters only filter the list. A new Claude/Codex session needs no configuration
dialog; its initial composer can adjust the captured selection before sending.
Runtime changes cancel pending creation and context attachment.

Settings expose native defaults and installed versions for all three engines.
Version checks use official package metadata. Shared or externally installed
runtimes show their owner and manual action; a supported native update requires
confirmation and an idle runtime. Application updates use the Multichamber fork.

Search, pinned context, scheduled existing-session sends, Multi-run and Goals
route through the session's owning engine. Scheduled sends retain their captured
selection. Goals use authoritative activity and available usage; a token budget
cannot silently continue when native usage is unknown. OpenCode-only operations
remain explicit capability limits in the parity table.

The integrated backend suite passed 699 tests with one skipped case. The
Electron suite passed all 54 test files. Twenty isolated UI files passed, with
additional focused regressions for runtime cancellation, native initial controls,
settings labels and document extraction. Combined type-check, lint, dead-code,
web build, mobile asset preparation, Electron bundle and Docker build passed.
Lint retains the existing `HtmlRenderFrame` hook warning; dead-code retains one
mobile configuration glob hint. Native CLI updates were checked without running
an upgrade. Platform installation and final visual QA are recorded separately.

The NAS pilot now serves the revised backend and UI at `10.71.14.2:3080`.
Its `/api/engines` reports all three engines available, and `/api/harnesses`
reports their installed versions. The served HTML matches the validated build
checksum. Activation restarted only the Multichamber pilot, after a copy of its
application data and confirmation that no native turn was active. The existing
OpenCode, official Multichamber and shared Codex processes retained their PIDs.

The Windows x64 installer was built on ProArt with Electron's native modules,
and its packaged OpenCode 2.0.32 executable passed verification. The candidate
installer is unsigned. Its source manifest and shared UI archive were verified
before packaging; its UI index checksum matches the NAS build. Installation
and native update handoff are separate checks, and an installer build does not
prove N-to-N+1 automatic update behavior.

Final browser QA used an isolated app profile with OpenCode unreachable. Codex
opened with native defaults. At 390 pixels the compact composer opened on a
real pointer click, accepted local text without sending, and had no horizontal
overflow. Switching to 1440 pixels kept that draft and its text. This validates
the hosted mobile layout; it does not validate an iOS/Android native package.

ProArt now runs the candidate from its own `Programs\Multichamber` folder in the
interactive Windows session. Packaged UI QA confirmed the Multichamber window
title, live editor, NAS API connection and all three engines available. The
previous installation and offline profile were backed up. Its tray process did
not respond to the attempted normal quit paths, so installation used a controlled
stop of only Multichamber's processes. Renderer storage flushing during that
stop was not verified. This was a direct installer replacement, not a test of
automatic update handoff.

## Codex product corrections on 20 October 2026

Codex context fill uses its latest native request and model context window,
separate from turn usage. History, live metadata and compaction use the same
contract; missing native usage or limits do not become a 200K estimate. The
reported 159.6% used turn billing with an invented fallback window. An isolated
browser reading of the corrected session showed 42.1% against the native window.
The value changes as the session runs.

Native sessions no longer present OpenCode MCP connections or skills as their
own. Shared links and knowledge remain available. Untitled Codex child sessions
use native identity for their display label and open in their own directory.
The legacy product sprite identifier now draws the Multichamber M. Windows
executable and runtime window icon extraction confirmed the M; the two own app
shortcuts received a content-addressed icon and scoped Explorer refresh.

An independent product review reproduced three further defects. Live turn
usage now counts every native request from cumulative deltas, while context
continues to use the latest request. Turn-scoped usage cannot produce a claimed
final-response token rate. Steer delivery uses `turn/steer` with the expected
active turn. Existing sessions display effective permissions from resume, or
an unknown state, without borrowing new-session defaults. Isolated review
fixtures rechecked all three corrections, and 97 focused UI tests passed.
No existing conversation received an inference prompt during these checks.

The corrected candidate is active on the NAS. The final UI index checksum is
`36b647b081b0fb8bb8842541293e87aedfd8708d68a5149973b393cf26c2438f`.
A current-session probe reported 456,283 of 997,500 context tokens, 45.7%, and
browser QA displayed the same native reading, named subagents and no borrowed
OpenCode MCP/skills rows. Context changes while the thread runs. Combined
validation passed 144 backend tests with one skip, the focused UI regressions,
workspace type-check, lint and dead-code checks. The existing lint warning and
mobile configuration hint remain unchanged.

The corrected Windows x64 installer was installed on ProArt. Packaged-window
QA on the same Codex thread reported 46.7% current context and confirmed the
Multichamber M sprite with no old cube. The native subagent section contained
five children; OpenCode MCP/skills counts were absent. This uses the same UI
archive and index as the NAS. The installer SHA-256 is
`e0bdd9aa7b769e55870e691d6ac2f4ab482220814d0dfcd246a9dbbe714a3c61`.

The native child display name is shared by chat panel tabs, desktop/mobile
headers and Mini Chat. Existing chat tabs refresh their saved display fallback
when native identity arrives, including a same-timestamp metadata update. This
changes display labels only. Explicit session titles and root-session names
remain authoritative. Windows received this UI-only update with an atomic web
asset swap; the installed backend archive checksum stayed unchanged. Packaged
QA confirmed the reviewer child's tab and tooltip show its native Volta identity
and agent path instead of `Untitled session`.
