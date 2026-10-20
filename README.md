# <img src="packages/ui/src/assets/multichamber-brand.svg" width="36" height="36" alt="Multichamber" align="absmiddle" /> Multichamber

[![GitHub stars](https://img.shields.io/github/stars/jibanez-staticduo/multichamber?style=flat)](https://github.com/jibanez-staticduo/multichamber/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/jibanez-staticduo/multichamber?style=flat)](https://github.com/jibanez-staticduo/multichamber/releases)

**One workspace for OpenCode, Claude Code and Codex, using each engine's native sessions.** Browse history, follow live work, answer approvals and open subagent conversations from the same web, desktop or mobile interface.

## Built on OpenChamber

Multichamber is an independent fork of [OpenChamber](https://github.com/openchamber/openchamber). The original project and its contributors built the shared interface, server, desktop and mobile foundations, and most of the workflow features in this repository. That work is the foundation of Multichamber.

The fork also draws on the native Claude Code integration developed in [pocharlies-org/openchamber](https://github.com/pocharlies-org/openchamber). Multichamber brings that work forward alongside native Codex support and keeps the three engines behind one session interface. Credit for the original and derived work remains with their respective contributors.

Multichamber has its own identity and release feed. It is not the official OpenChamber distribution and does not represent the OpenCode, Anthropic or OpenAI teams.

## Why this fork?

A model provider and a session engine are different things. An OpenCode session using an OpenAI model is still an OpenCode session. A Codex thread belongs to Codex; a Claude Code conversation belongs to Claude Code.

Multichamber keeps those owners intact. It reads native histories and routes prompts, permissions and lifecycle actions to the engine that owns the conversation. It does not copy native conversations into OpenCode or send unsupported actions to another engine.

- **OpenCode:** provider and agent configuration, native sessions and the existing OpenChamber workflow.
- **Claude Code:** native history, model and permission controls, streaming tools, approvals, questions and linked subagent transcripts. Existing CLI ownership and remote-control limits remain visible.
- **Codex:** native app-server threads, model and reasoning controls, permissions, live tools, approvals, child threads and inter-agent messages. The default transport connects to an existing Codex authority.

Settings offer a default engine and separate native model, effort and permission preferences. OpenCode provider, agent and tool settings apply to OpenCode. Display preferences and shared project context remain app-level settings. MCP and skill counts are shown only where their source belongs to that engine.

## Capabilities and limits

All three engines support conversation history, prompts, interruption, archive/restore, whole-conversation forks, permissions and questions. Session Goals use the owning engine and require a configured progress checker.

Some workflows remain engine-specific. OpenCode owns session moves, arbitrary shell messages, revert, turn diffs and side generation. Codex does not fork at arbitrary message boundaries or expose its native command system through this integration. Claude subagent transcripts are read-only. The UI hides unsupported actions and the server refuses them.

See the [project identity and compatibility notes](docs/PROJECT_IDENTITY.md), [capability matrix](docs/agent-parity.md), [Codex adapter](packages/web/server/lib/codex/DOCUMENTATION.md) and [Claude adapter](packages/web/server/lib/claude/DOCUMENTATION.md) for the current contracts. Native credentials stay with the corresponding CLI; Multichamber does not add a shared credential store.

## Work across devices

| Surface | Role |
| --- | --- |
| Web / PWA | Connect to the server from a browser or installed web app |
| Electron desktop | macOS, Windows and Linux shell, local or remote server connections, native windows and notifications |
| iOS / Android | Capacitor app connected to an existing server; native mobile packaging and signing are separate |
| CLI / server | Host sessions and shared workflows on a workstation or server |

The workspace retains upstream features such as Git review, changes walkthroughs, preview, project context, scheduling and remote access. Availability depends on the selected engine and runtime. This fork does not ship a VS Code extension.

## Run from source

Use the Node.js and Bun versions declared in [package.json](package.json). Install each native engine you want to use on the machine running the server and complete its own sign-in first.

```bash
bun install
bun run dev
```

For desktop development, use `bun run electron:dev`. See [CONTRIBUTING.md](CONTRIBUTING.md) for builds and focused validation. The package READMEs cover [web/server](packages/web/README.md), [desktop](packages/electron/README.md), [mobile](packages/mobile/README.md) and the [extension SDK](packages/sdk/README.md).

For packaged installation, use the instructions and assets attached to a release in [this fork's Releases](https://github.com/jibanez-staticduo/multichamber/releases). Each release lists its files and platform notes.

## Updates

Multichamber app/server updates use `jibanez-staticduo/multichamber` release assets. They do not install the upstream OpenChamber package. Desktop uses its platform installer; mobile distribution has its own signing and store requirements.

Hosted relay, push relay and Linear OAuth require endpoints or credentials configured for this fork. There is no implicit dependency on upstream hosted services.

Engine updates are separate. Settings show installation and version information for OpenCode, Claude Code and Codex and let you check their official package metadata. A known supported native installer requires confirmation. Shared or externally owned installations show a manual action; existing shared services are not restarted automatically. Updating an installed CLI does not establish that an already-running daemon uses the new executable.

## Contribute

Use [this repository's issues](https://github.com/jibanez-staticduo/multichamber/issues) for fork-specific bugs and agree on user-visible behavior with the maintainer before implementing it. Upstream OpenChamber issues and community channels belong to that project. Read [CONTRIBUTING.md](CONTRIBUTING.md) before preparing a change.

## License and credits

[MIT](LICENSE). Preserve existing copyright and license notices. In addition to OpenChamber and pocharlies-org/openchamber, this project builds on OpenCode and the open-source libraries credited in their source and package metadata.
