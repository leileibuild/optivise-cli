---
name: smart-planner-cli
description: |
  Teach agents to use @smart-planner/cli (npm latest) via /v3 CSV workflow. Bootstrap CLI once (never npx per
  command); persist backend URL in ~/.smartplanner/config.json; invoke via $SP directly. Use sync solve for
  small problems (≤100 items), async + runs wait/download for large. Minimize tool calls — no TaskCreate for
  linear flows. Never reinstall CLI if already present. Ask user to OAuth-login only on quota/auth errors.
---

# Smart Planner CLI — Agent workflow

**Package:** `@smart-planner/cli` (npm **`latest`**)  
**Repo:** `cli/` at repository root  
**Solver:** server `/v3` — sync or async depending on problem size.

Install once: `npm install @smart-planner/cli@latest`

---

## Rule zero: bootstrap once, never install every task

**Most agent time is wasted re-running `npx` or `npm install` on every command.** Each npx call costs 3–10s. Actual solves on small demos are often milliseconds.

| Do once | Reuse every command |
|---------|---------------------|
| Install CLI **one time** to a fixed path | Same `$SP` binary |
| Write `~/.smartplanner/config.json` with backend URL | No repeated `export` |
| Set `$SP` in shell session | All commands |

**Never per task:** `npx @smart-planner/cli ...`, `npm install @smart-planner/cli`, throwaway workspaces.

---

## Sync vs async — pick by problem size

**Do not use `--async` for every solve.** Extra async steps cost 2+ CLI calls and agent turns.

### Decision tree

```text
Count primary dataset rows (CSV data rows, excl. header)
│
├─ ≤100 items  → SYNC (default for demos / agent tasks)
│   $SP solve --wait-timeout 30 --format json [--out-dir ./out]
│   • 1 CLI call; result in JSON (run.summary, run.previews, output_files)
│   • Skip validate if CSV/config unchanged since last success
│   • Skip runs status/wait/download
│
└─ >100 items OR solver time_limit > 60s OR prior sync timed out
    → ASYNC
    $SP solve --async --format json
    $SP runs wait --run-id <id> --timeout 60 --format json
    (exit 2 → check again later)
    $SP runs download --run-id <id> --out-dir ./out --format json
```

### Sync solve output (small problems)

One call returns everything needed:

```json
{
  "run": {
    "state": "succeeded",
    "summary": { "solver_status": "OPTIMAL", "allocated_units": 80 },
    "previews": { "allocations": [ "...first 10 rows..." ] }
  },
  "output_files": ["./out/allocations.csv"]
}
```

Read `run.summary` + `run.previews` for quick answers; read `output_files` only if full CSV needed.

### Async exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | `succeeded` | Download if not already inline |
| 1 | `failed` | Fix CSV/config |
| 2 | still running | **Come back later** — same `run_id` |

---

## Tool-call budget

Minimize agent tool calls. Target counts **include shell + file reads**, not CLI sub-steps.

| Scenario | Target calls | Skip |
|----------|--------------|------|
| **Small problem, data ready** | **3–5** | TaskCreate/TaskUpdate, validate (if unchanged), `--async` polling, `--version` check |
| **Large problem, data ready** | **6–8** | TaskCreate, `--version` check |
| **Greenfield new project** | **8–12** | spec (use models get), redundant validate |

### Optimal small-problem flow (~5 calls)

```text
1. [parallel] Read config.json + project.yaml + data/*.csv
2. $SP solve --wait-timeout 30 --out-dir ./out --format json
3. Read result (from JSON previews/summary OR output_files)
4. Present summary to user
```

**Do not** create 4 TaskCreate items for this linear pipeline.

### Parallel reads (always)

When entering a project directory, read in **one parallel batch**:

- `project.yaml`
- `config.json`
- all `data/*.csv`

Do not read them one-by-one across separate turns.

---

## Step 0 — Bootstrap (only if CLI missing)

If `$SP` is already set and works from a prior turn in the same environment, **skip detect entirely**.

### Detect (once per environment, not every task)

```bash
# Only if $SP unknown:
command -v smart-planner >/dev/null 2>&1 && smart-planner runs --help
# OR
test -f "$HOME/.smartplanner/cli/node_modules/@smart-planner/cli/dist/index.js" \
  && node "$HOME/.smartplanner/cli/node_modules/@smart-planner/cli/dist/index.js" runs --help
# OR repo: test -f cli/dist/index.js && node cli/dist/index.js runs --help
```

If `runs --help` works → set `$SP`, **done**. Do **not** also run `--version`.

### One-time install (all checks fail)

```bash
CLI_HOME="${SMART_PLANNER_CLI_HOME:-$HOME/.smartplanner/cli}"
NPM_CACHE="${SMART_PLANNER_NPM_CACHE:-$CLI_HOME/.npm-cache}"
mkdir -p "$CLI_HOME" "$NPM_CACHE"
npm install @smart-planner/cli@latest --prefix "$CLI_HOME" --cache "$NPM_CACHE" --no-fund --no-audit
export SP="node $CLI_HOME/node_modules/@smart-planner/cli/dist/index.js"
```

### Persist backend URL (once, no OAuth)

```bash
mkdir -p ~/.smartplanner
printf '%s\n' '{"backendUrl":"https://smart-planner-808969362008.us-south1.run.app"}' > ~/.smartplanner/config.json
```

Agents must **not** run `login` (browser). User runs login only on 401/quota.

---

## Step 1 — Invoke: always `$SP`, never npx

```bash
# Small (typical):
$SP solve --wait-timeout 30 --out-dir ./out --format json

# Large:
$SP solve --async --format json
$SP runs wait --run-id <id> --timeout 60 --format json
```

**Wrong:** `npx @smart-planner/cli ...` on every subcommand.

---

## Workflow paths

### Fastest — small problem, data ready (≤100 items)

```bash
cd examples/capacity-planning-demo
# parallel read: project.yaml, config.json, data/work_items.csv
$SP solve --wait-timeout 30 --out-dir ./out --format json
# answer from run.summary / run.previews; optional: read ./out/*.csv
```

**Skip:** validate (if data unchanged), `--async`, runs poll/download, models list, spec.

### Fast — large problem, data ready (>100 items)

```bash
cd my-project
$SP validate --format json          # optional if data changed
$SP solve --async --format json
$SP runs wait --run-id <ID> --timeout 60 --format json
$SP runs download --run-id <ID> --out-dir ./out --format json
```

### Greenfield — new project

```bash
$SP models list --format json
$SP models get --model-id <id> --format json    # skip spec
$SP init --model-id <id> my-project
# edit CSV + config
# then Fastest or Fast path based on row count
```

---

## Command reference

| Command | When |
|---------|------|
| `models list --format json` | Greenfield — pick model_id |
| `models get --model-id <id> --format json` | Schema (prefer over `spec`) |
| `init --model-id <id> [dir]` | Greenfield scaffold |
| `validate --format json` | Data/config **changed**; or before first large solve |
| `solve --wait-timeout 30 --format json` | **Small problems (≤100 items)** |
| `solve --async --format json` | **Large problems** |
| `runs status --run-id <id> --format json` | Async — quick poll |
| `runs wait --run-id <id> --timeout 60 --format json` | Async — bounded wait |
| `runs download --run-id <id> --out-dir ./out` | Async — after succeeded |

---

## Agent operating rules

| Rule | Do | Do not |
|------|----|--------|
| **Problem size** | Sync ≤100 items; async >100 | `--async` for 4-row demos |
| **CLI** | Bootstrap once; reuse `$SP` | npx every command |
| **Install** | Only when `$SP` missing | Install when CLI works |
| **Detect** | `runs --help` once | `--version` every task |
| **Files** | Parallel read config + CSV | Sequential reads |
| **validate** | Only when data changed | Re-validate unchanged data |
| **Tasks** | Direct shell flow | TaskCreate for linear 3-step flows |
| **Backend URL** | `~/.smartplanner/config.json` once | export every task |
| **Login** | User on 401/quota | Agent OAuth |

---

## Full session examples

### Small — capacity demo (sync, ~3 CLI calls)

```bash
export SP="node $HOME/.smartplanner/cli/node_modules/@smart-planner/cli/dist/index.js"
cd examples/capacity-planning-demo
$SP solve --wait-timeout 30 --out-dir ./out --format json
```

### Large — async with poll

```bash
export SP="node $HOME/.smartplanner/cli/node_modules/@smart-planner/cli/dist/index.js"
cd my-project
$SP solve --async --format json
$SP runs wait --run-id run_xxx --timeout 60 --format json
$SP runs download --run-id run_xxx --out-dir ./out --format json
```

---

## Pre-flight checklist

- [ ] `$SP runs --help` works (skip install if yes)
- [ ] `~/.smartplanner/config.json` has backendUrl
- [ ] Estimated row count → sync vs async chosen
- [ ] `--out-dir ./out` writable (if downloading)
- [ ] No TaskCreate for simple linear solve

---

## Anti-patterns

- **Do not** use `--async` on small problems (≤100 items) — wastes 2+ calls
- **Do not** create TaskCreate/TaskUpdate for simple validate→solve linear flows
- **Do not** re-validate when CSV and config unchanged since last success
- **Do not** run `--version` when `$SP` already known to work
- **Do not** run `npx` per subcommand
- **Do not** `npm install` when CLI already on disk
- **Do not** tight-loop `runs wait`
- **Do not** blocking sync solve on large problems (use `--async`)
- **Do not** agent `login`

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Too many tool calls | Sync solve for small; skip validate; no TaskCreate |
| Agent timeout on sync | Switch to `--async` + runs wait |
| Sync timed out (`wait-timeout`) | Retry `--async` with same data |
| Slow every command | Bootstrap once; use `$SP` not npx |
| `Missing backend URL` | Write `~/.smartplanner/config.json` |
| `401` / quota | Ask user to `login` |
| Missing `runs` subcommand | Re-install `@latest` |

---

## Related

- Example: `examples/capacity-planning-demo/` (4 rows → **sync**)
- Docs: `docs/cli.md`, `docs/problem_agnostic_api.md`

**Summary:** bootstrap once → `$SP` → config once → **sync if small / async if large** → minimal tool calls.
