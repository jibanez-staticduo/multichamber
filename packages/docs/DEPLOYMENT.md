# Docs Source Deployment

This repository packages Multichamber documentation sources. It does not deploy
a hosted website by default.

## Source archive workflow

[docs-source.yml](../../.github/workflows/docs-source.yml) runs on:

- pushes to `main` that change docs, validation scripts or the root manifest;
- published releases;
- manual dispatch, optionally naming a release tag for the archive upload.

It validates the source with `bun run docs:validate`, creates
`multichamber-docs-source-<sha>.tar.gz`, and uploads the workflow artifact named
`multichamber-docs-source`. Releases and manual runs with `release_tag` also
attach that archive to the selected release. These are source artifacts, not a
built or hosted website.

## Optional website notification

To notify a separate website, configure both in this repository:

| Setting | Purpose |
| --- | --- |
| Repository variable `MULTICHAMBER_DOCS_WEBSITE_REPO` | Explicit destination in `owner/repository` form |
| Secret `MULTICHAMBER_DOCS_WEBSITE_REPO_TOKEN` | Credential allowed to send repository dispatches to that destination |

There is no upstream or other default destination. If either value is absent,
the step logs that website sync is unconfigured and succeeds without sending a
request. Configuring a destination authorizes notification, not deployment from
this workflow. The receiving repository owns its renderer, build, hosting and
credentials.

The notification keeps the existing consumer contract:

- `event_type`: `docs_source_updated`;
- `client_payload.source_repo`: the repository running this workflow;
- `client_payload.source_ref`: the release tag for a release event, otherwise
  the selected branch or tag name;
- `client_payload.archive_name`: the generated archive filename.

A manual `release_tag` selects the release receiving the archive; it does not
change the checked-out source or `source_ref`. Select the intended source ref
when dispatching the workflow.

The receiving repository must opt into `docs_source_updated` and resolve the
source repository and ref from the payload. No particular website repository,
Cloudflare account or published site is assumed here.
