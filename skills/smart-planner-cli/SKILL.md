---
name: smart-planner-cli
description: |
  Teach agents how to use @smart-planner/cli for optimization modeling and solving via the /v3 CSV workflow.
  Agents set backend URL via environment variable (never login first), reuse an already-installed CLI without
  reinstalling, prefer local cli/dist/index.js in this repo, use a fast validate→solve path when data is ready, and only ask the user to login when quota or auth errors occur.
  Use when modeling, validating, or solving planning/scheduling problems without writing adapter code.
---

# Smart Planner CLI — Agent modeling & solve workflow

Use this skill when an agent must **validate** and **solve** through the CLI — not by editing Python adapters in this repo.

## Agent operating rules (read first)

These rules prevent wasted tool calls and blocked browser flows.

| Rule | Do | Do not |
|------|----|--------|
| **Backend URL** | Set `SMART_PLANNER_BACKEND_URL` in the shell | Call `login` proactively |
| **CLI binary** | Reuse whatever is already available (see below) | Run `npm install` / `npx` if CLI already works |
| **Install / build** | Build **only** when `cli/dist/index.js` is missing | Re-install on every task |
| **Login / register** | **Never** run `login` yourself — it opens a browser and blocks automation | Assume the agent can complete OAuth |
| **Quota / auth errors** | Stop and tell the **user** to run `login` in their own terminal | Retry login or install loops |
| **Output directory** | Always pass `--out-dir` to a writable workspace path | Default to repo `results/` (may EPERM) |
| **Ready projects** | Skip `models list` / `spec` / `init` when CSV + config already exist | Re-explore on every run |
| **Validate** | Always run before first `solve` in a session | Skip validate when inputs changed |

**Minimal path when data is already prepared** (e.g. `examples/capacity-planning-demo/`):

```bash
export SMART_PLANNER_BACKEND_URL=http://localhost:8000   # or production URL
# SP = smart-planner  OR  node ../../cli/dist/index.js  (whichever already works)
cd examples/capacity-planning-demo
$SP validate --format json
$SP solve --out-dir ./out --format json
# read ./out/*.csv
```

Five steps: resolve CLI once → set env → validate → solve with `--out-dir` → read results. **No install step.**

## What the agent owns vs the platform

| Layer | Owner | Agent action |
|-------|-------|--------------|
| Business requirements → CSV rows | **Agent** | Edit `data/*.csv` (use `spec` only when schema unknown) |
| Constraints, objectives, solver | **Agent** | Edit `config.json` |
| Parse, build, solve | **Server** | `validate` / `solve` |
| Results | **Agent** | Read artifacts from `--out-dir` |

Do **not** modify `adapters/**/data.py` or `model.py` for standard CLI workflows.

## Prerequisites

1. **Node.js ≥ 18**
2. **Backend** with `/v3` routes reachable
3. **Backend URL** via environment variable (required; no login needed for anonymous deployments):

```bash
export SMART_PLANNER_BACKEND_URL=http://localhost:8000
# production: https://smart-planner-808969362008.us-south1.run.app
```

Optional persistence: write the same URL to `~/.smartplanner/config.json` as `{"backendUrl":"..."}` — agents should prefer the env var in the current shell instead of calling `login --backend-url`.

## How to invoke the CLI

**First: resolve the binary once.** Do not install unless every candidate below fails.

### CLI resolution order (stop at first hit)

```text
1. Global binary on PATH          → smart-planner <cmd>
2. Local repo build (this repo)   → node cli/dist/index.js <cmd>
3. npx cached / published pkg     → npx @smart-planner/cli <cmd>
4. Build local (last resort)      → cd cli && npm run build   # only if dist/ missing
```

**Detection (run once per session, before any workflow step):**

```bash
# 1) already installed globally?
command -v smart-planner && smart-planner --version

# 2) local repo build present?
test -f cli/dist/index.js && node cli/dist/index.js --version

# 3) otherwise try npx without reinstalling
npx @smart-planner/cli --version
```

If step 1 or 2 succeeds, set `SP` and **never** run `npm install`, `npm install -g`, or `npx` download again in that session.

| If available | Set SP to | Example |
|--------------|-----------|---------|
| Global install | `SP=smart-planner` | `smart-planner validate --format json` |
| Local `cli/dist/index.js` | `SP="node $(pwd)/cli/dist/index.js"` | `$SP solve --out-dir ./out --format json` |
| npx only | `SP="npx @smart-planner/cli"` | `$SP models list --format json` |

### When to build or install (rare)

| Condition | Action |
|-----------|--------|
| `cli/dist/index.js` exists | **Use it directly** — no `npm install` |
| `smart-planner` on PATH works | **Use it directly** — no install |
| `npx @smart-planner/cli --version` works | **Use npx directly** — no `npm install` in a new workspace |
| `cli/dist/index.js` missing but `cli/` source exists | `cd cli && npm run build` once (skip `npm install` if `cli/node_modules` already present) |
| No local checkout and npx fails | Ask user; do not loop install attempts |

### Agent alias pattern

Set once per shell session after resolution:

```bash
export SMART_PLANNER_BACKEND_URL=http://localhost:8000
SP=smart-planner   # or: SP="node /abs/path/smart-planner/cli/dist/index.js"

$SP validate --format json
$SP solve --out-dir "$PWD/out" --format json
```

Use **`--format json`** on all agent-facing commands.

### External machines (no local checkout)

```bash
npx @smart-planner/cli@latest <command> [options]
```

Use npx only when neither global `smart-planner` nor local `cli/dist/index.js` exists. If npx fails (cache `safe-delete`, EPERM), ask the user — do not create throwaway workspaces to `npm install`.

## Workflow paths

### Fast path — project already has `project.yaml`, `data/*.csv`, `config.json`

Use when the user points at an existing demo or a previously scaffolded project and requirements already match the files.

```text
1. Read data/*.csv + config.json (confirm they match user intent)
2. export SMART_PLANNER_BACKEND_URL=...
3. validate --format json
4. solve --out-dir <writable-dir> --format json
5. Read result CSVs and summarize
```

Skip `models list`, `spec`, and `init` unless validate errors reference unknown columns or missing files.

### Full path — greenfield modeling

Use when starting from scratch or the model/datasets are unknown.

```text
1. models list --format json     → pick immutable model_id (@sha256:…)
2. spec --format json            → datasets, fields, config_schema
3. init --model-id <id> [dir]    → scaffold templates
4. Edit data/*.csv + config.json
5. validate → solve --out-dir <writable-dir>
6. Read results
```

`spec` is mandatory **before editing data** on greenfield work, not on every re-solve.

## Authentication — agents do not login

Anonymous access works by default on most deployments. **Agents must not run `smart-planner login`.** It opens a browser, waits for human OAuth, and stalls automation.

### When to ask the user to login

Stop the CLI loop and give the user this one-liner **only** when a command fails with:

| Signal | Meaning | User action (human terminal) |
|--------|---------|------------------------------|
| HTTP **401** / `unauthorized` / `Authentication is required` | Server requires Bearer token | `npx @smart-planner/cli login --backend-url <url>` |
| HTTP **403** + quota / rate-limit message | Anonymous quota exhausted | Same — user logs in to get a principal |
| HTTP **429** | Rate limited | Wait, or user logs in for higher limits |

Agent message template:

> Anonymous quota/auth limit reached. Please run in your terminal:
> `npx @smart-planner/cli login --backend-url <BACKEND_URL>`
> Then ask me to retry validate/solve.

**Local dev without browser** (user only): `login --backend-url <url> --local-dev` when server has `SMART_PLANNER_LOCAL_AUTH=1`.

After the user confirms login, retry `validate` / `solve` — the saved session in `~/.smartplanner/session.json` is picked up automatically.

## Step reference

### Discover models (full path only)

```bash
$SP models list --format json
```

Pick immutable `model_id` (`capacity-planning@sha256:3c52f6d1`). Reject `latest` and bare names.

### Spec (full path, before editing data)

```bash
$SP spec --model-id capacity-planning@sha256:3c52f6d1 --format json
```

Key fields: `datasets`, `result_datasets`, `config_schema`, `constraints`, `objectives`, `validate_rules`.

### Init (full path only)

```bash
$SP init --model-id capacity-planning@sha256:3c52f6d1 my-project
cd my-project
```

Creates `project.yaml`, `config.json`, `data/<dataset>.csv`.

### Prepare inputs

**CSV rules:** one file per dataset as `data/<name>.csv`; UTF-8; headers match spec order; ISO datetimes with `Z`; no Excel in v3 CLI path.

**config.json envelope:**

```json
{
  "constraints": { "capacity_limit": true },
  "objectives": { "maximize_priority": true },
  "weights": { "maximize_priority": 1.0 },
  "parameters": { "capacity_units": 80 },
  "solver": { "time_limit_seconds": 30, "workers": 4 },
  "extras": {}
}
```

### Validate (always before solve)

```bash
cd <project-dir>
$SP validate --format json
```

On failure, fix cited `dataset` / `line` / `column`, re-run until `"valid": true`.

### Solve (always with writable --out-dir)

```bash
mkdir -p out
$SP solve --out-dir ./out --format json
```

**Always** pass `--out-dir` to a directory the agent can write (workspace temp, `./out`, user home). Do not rely on default `results/` inside read-only or permission-restricted trees.

Success JSON includes `output_files` — read those CSV paths for the answer.

## Command reference

| Command | When to use | Agent flags |
|---------|-------------|-------------|
| `models list` | Greenfield — pick model | `--format json` |
| `spec` | Greenfield — before editing CSV | `--model-id`, `--format json` |
| `init` | Greenfield — scaffold | `--model-id`, `[dir]` |
| `validate` | Every run before solve | `--format json`, [`--verbose`] |
| `solve` | After valid validate | `--out-dir <writable>`, `--format json` |
| `login` | **User only** on quota/auth failure | — |
| `whoami` | Debug auth state | — |

| Variable | Effect |
|----------|--------|
| `SMART_PLANNER_BACKEND_URL` | Backend base URL (**primary** for agents) |

## Examples

### Fast — capacity-planning demo (data ready)

```bash
export SMART_PLANNER_BACKEND_URL=http://localhost:8000
# reuse existing CLI — do not install again:
SP=smart-planner   # if globally installed
# SP="node ../../cli/dist/index.js"   # if local dist already built

cd examples/capacity-planning-demo
$SP validate --format json
mkdir -p out && $SP solve --out-dir ./out --format json
# read out/allocations.csv
```

### Full — greenfield

```bash
export SMART_PLANNER_BACKEND_URL=http://localhost:8000
SP=smart-planner   # or node cli/dist/index.js if already built

$SP models list --format json
$SP spec --model-id capacity-planning@sha256:3c52f6d1 --format json
$SP init --model-id capacity-planning@sha256:3c52f6d1 capacity-demo
cd capacity-demo
# edit data/work_items.csv, config.json
$SP validate --format json
mkdir -p out && $SP solve --out-dir ./out --format json
```

## Pre-solve checklist

- [ ] `SMART_PLANNER_BACKEND_URL` set in shell
- [ ] CLI resolved once (`smart-planner`, local `cli/dist/index.js`, or npx) — **no redundant install**
- [ ] Required `data/*.csv` present; headers correct
- [ ] `config.json` matches user requirements
- [ ] Last `validate` returned `"valid": true`
- [ ] `solve` uses `--out-dir` to a writable path

## Anti-patterns

- **Do not** call `login` at the start of a workflow
- **Do not** run `npm install` / `npm install -g` when `smart-planner` or `cli/dist/index.js` already works
- **Do not** run `npm install` on every task — install/build is one-time unless `dist/` is missing
- **Do not** start with npx download when global or local CLI is already available
- **Do not** create a throwaway node workspace just to install the CLI
- **Do not** call `solve` without `--out-dir` in automated runs
- **Do not** re-run `models list` + `spec` when editing CSV and re-solving the same project
- **Do not** skip `validate` after changing CSV or config
- **Do not** invent dataset/column names — use `spec` when unsure
- **Do not** write adapter code for standard CLI flows

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Missing backend URL` | Env not set | `export SMART_PLANNER_BACKEND_URL=...` |
| Agent wasted time on install | CLI already present | Resolve binary first; skip install |
| npx safe-delete / EPERM | npm cache conflict | Use global `smart-planner` or `node cli/dist/index.js` |
| Solve succeeds but no files | Default out dir not writable | `--out-dir ./out` in workspace |
| `404` on `/v3/models` | Wrong URL or old server | Check `/health`; use v3-enabled backend |
| `401` / quota / `429` | Auth or rate limit | **Ask user** to `login`; do not agent-login |
| `mutable_model_alias` | Non-immutable model_id | Use full id from `models list` |
| Validate errors on columns | Wrong headers | Run `spec` or read existing template headers |

## Related docs

- CLI reference: `docs/cli.md`
- v3 API: `docs/problem_agnostic_api.md`
- Example (fast-path ready): `examples/capacity-planning-demo/`

## Escalate beyond CLI when

- Required model is not in `models list`
- Problem cannot be expressed as v3 CSV datasets

Otherwise: **env URL → validate → solve --out-dir** (fast) or **spec → edit → validate → solve** (greenfield).
