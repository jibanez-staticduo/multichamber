# Multichamber Docs Source

This package is the source-of-truth for Multichamber public docs content.

## Layout

- `content/docs/*.mdx` - English docs pages (source of truth)
- `content/docs/<locale>/*.mdx` - translations, mirroring the English filenames
  (e.g. `uk/`, `zh-cn/`, `pt-br/`, `fr/`, `tr/`); see `CONTRIBUTING.md` → Localization
- `sidebar.config.json` - docs navigation structure for Starlight sidebar
- `CONTRIBUTING.md` - authoring guide for adding pages, sections, and translations
- `DEPLOYMENT.md` - release/manual packaging and sync trigger model

## Local validation

Run from repo root:

```bash
bun run docs:validate
```

This validates:

- frontmatter (`title`, `description`) exists for every MDX page
- sidebar links resolve to existing MDX routes

## Deployment model

This repo owns docs content.

This repository does not configure a hosted documentation site by default. A
separate website may consume these sources when its repository and dispatch
credential are explicitly configured; see [DEPLOYMENT.md](DEPLOYMENT.md).

Use [docs-source.yml](../../.github/workflows/docs-source.yml) to validate and
package `multichamber-docs-source-<sha>.tar.gz` on docs pushes, releases or manual
triggers. Packaging an artifact does not publish a website.
