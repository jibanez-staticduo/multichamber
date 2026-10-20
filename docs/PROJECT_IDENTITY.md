# Multichamber identity

Multichamber is the product, package namespace and distribution owned by this
fork. OpenChamber remains credited in the project README and copyright notices.
Third-party integrations retain their real publisher, package and repository.

## Canonical names

| Boundary | Identity |
| --- | --- |
| Workspace packages | `@multichamber/ui`, `@multichamber/web`, `@multichamber/electron`, `@multichamber/mobile`, `@multichamber/sdk` |
| Commands | `multichamber`, `multichamber-guest-bundle` |
| Application API | `/api/multichamber/*` |
| Process configuration | `MULTICHAMBER_*` |
| Web release assets | `multichamber-web.tgz`, `multichamber-web-<version>.tgz` |
| Extension manifests | `multichamber`, `engines.multichamber` |
| Default themes | `multichamber-light`, `multichamber-dark` |
| Native app identifier | `com.staticduo.multichamber` |
| App release source | `jibanez-staticduo/multichamber` |

The app/server checker reads the fork's stable release metadata. A release
without its canonical web archive is incomplete, and a foreign or mismatched
asset URL is refused. Desktop uses the same fork through electron-updater.
Native engine version checks do not select the Multichamber application version.

## Existing installations

Legacy names remain only at compatibility boundaries where changing a name
would discard user data or break an installed client. These include saved
browser preferences and databases, session metadata, the desktop renderer
origin and bridge, native notification payloads, and third-party extension wire
messages. They are not another application identity or an update source.

`MULTICHAMBER_*` is normalized before configuration modules run. Explicit
canonical values win, including an empty value. `/api/multichamber/*` reaches
the same authenticated handlers as the legacy API. Old extension manifests and
saved theme IDs are read through explicit aliases. The installer recognizes an
older package name when checking ownership; downloads always come from the fork.

A storage-origin or credential migration needs its own verified conversion.
Mechanical replacement of these legacy bytes would lose settings, pairing or
conversation metadata. The native update handoff still needs platform QA after
changes to package identity; source checks do not establish successful updates.
