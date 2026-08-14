# @smart-planner/cli

Standalone npm package for the Smart Planner v3 CSV workflow (`npx @smart-planner/cli`).

This folder is intentionally separate from the Python backend (`src/`), adapters (`adapters/`), and other client packages (`apps_script/`, `airtable_extension/`). The CLI is a thin HTTP client against `/v3` routes on the Smart Planner server.

## Build

```bash
cd cli
npm install
npm run build
npm test
```

## Publish

```bash
cd cli
npm publish --access public
```

Or pack locally:

```bash
bash scripts/pack_npm_packages.ps1
```

## Usage

See [docs/cli.md](../docs/cli.md) and [.cursor/skills/smart-planner-cli/SKILL.md](../.cursor/skills/smart-planner-cli/SKILL.md).
