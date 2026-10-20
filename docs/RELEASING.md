# Release Multichamber

This guide describes the release workflow in this fork. Version 2.6.1 targets
web/server, Windows and Linux. macOS, iOS, Android and npm publication are not
part of that release.

The 2.6.0 draft failed Linux packaging and is not published. Version 2.6.1
contains the corrected 512-pixel Linux icon and is the stable candidate.

## Prepare the source locally

Write one coherent release story in `changelog/unreleased.md`, then use the
repository's release tool for future versions:

```bash
bun run oc-dev create-release --version <version>
```

The maintainer configuration must enable `features.releaseTools`. The tool
promotes the notes, runs `release:prepare`, bumps the release manifests and
prints the suggested commit/tag/push commands. It does not commit or push them.
Do not manually edit the generated changelog index or legacy changelog.

For 2.6.1, the version bump and promotion to `changelog/2.6.1.md` are already
prepared. Do not promote the now-empty unreleased template again. Review the
source and final validation evidence before committing it.

A commit, tag and push are separate maintainer actions. Pushing a `v*` tag starts
[release.yml](../.github/workflows/release.yml); pushing `main` alone does not
start this release workflow. A manual dispatch builds the selected ref and
requires its manifests and release notes to match the supplied version.

## Select the release inputs

For the 2.6.1 publication, use these manual workflow inputs:

| Input | Value | Effect |
| --- | --- | --- |
| `version` | `2.6.1` | Release tag `v2.6.1` and matching notes |
| `dry_run` | `false` | Create a draft and upload release assets |
| `build_web` | `true` | Package web/server with the matching SDK |
| `build_windows` | `true` | Build x64 and ARM64 installers |
| `build_linux` | `true` | Build x64 and ARM64 Linux distributions |
| `build_macos` | `false` | Skip Apple desktop builds |
| `build_mobile` | `false` | Skip Android and iOS distribution |
| `publish_npm` | `false` | Do not publish packages to npm |
| `publish_release` | `false` | Leave the release as a draft for QA |

Web, Windows and Linux default to enabled. The other build/publication switches
default to disabled. A tag push selects web, Windows and Linux through the
workflow's tag-event conditions; it also leaves the release draft.

The job named `publish-npm` also builds the web archive. With `publish_npm=false`
it does not publish either package to npm. GitHub release uploads use the built-in
`GITHUB_TOKEN` with the workflow's `contents: write` permission. npm credentials
are unnecessary for this release; Apple/mobile signing and store credentials are
also unnecessary while those targets are disabled.

## Dry run and draft QA

Set `dry_run=true` to exercise selected builds without creating a GitHub Release,
uploading release assets or publishing npm packages. Build jobs can still upload
workflow artifacts. The release asset inventory step is skipped because no
release exists; a successful dry run therefore does not prove the published
feed or installation path.

For a non-dry run, every upload remains draft. The final job verifies the
selected web archives, Windows installers, Linux files and update manifests.
It checks expected asset names, nonzero sizes and manifest references. Inspect
the run and draft assets; job success does not replace native installation QA.

Before publication, validate the actual selected artifacts:

- install the web archive in isolation and check its CLI, server and SDK;
- launch Windows and Linux packages and exercise their applicable update paths;
- verify history, creation and engine settings for OpenCode, Claude Code and Codex;
- check that each update manifest points to the matching fork artifact.

Record the OS, architecture, tested versions and any untested native behavior.
Do not infer macOS or mobile support from Windows/Linux results. See the
[desktop guide](../packages/electron/README.md) and its linked updater fixture
for platform-specific update validation.

## Publish after QA

Keep `publish_release=false` while artifacts are being reviewed. After the
maintainer accepts the draft and platform evidence, publish that existing draft
and mark it as latest:

```bash
gh release edit v2.6.1 --repo jibanez-staticduo/multichamber --draft=false --latest
```

This command changes the external release. Run it only as the explicit
publication step; it does not push local commits or tags. The workflow also has
an explicit `publish_release=true` gate, but the draft-first process above keeps
publication after artifact QA rather than at the end of the build.

After publication, check the public fork release and the web/native update feeds
against its assets. App publication does not update or restart users' native
OpenCode, Claude Code or Codex installations; those have separate ownership and
update checks.
