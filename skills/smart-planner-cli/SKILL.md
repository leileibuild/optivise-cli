---
name: smart-planner-cli
description: |
  Teach agents to use @smart-planner/cli (npm latest) via /v3 CSV workflow. Bootstrap CLI once (never npx per command);
  persist backend URL in ~/.smartplanner/config.json; invoke via node/smart-planner directly. Solves are async —
  use solve --async + runs status/wait/download. Never reinstall CLI if already present. Ask user to OAuth-login
  only on quota/auth errors.
---

# Smart Planner CLI — Agent workflow

**Package:** `@smart-planner/cli` (npm **`latest`**)  
**Repo:** `cli/` at repository root  
**Solver:** server `/v3` only — **async** runs.

Install / upgrade once: `npm install @smart-planner/cli@latest`

---

## Rule zero: bootstrap once, never install every task

**Most agent time is wasted re-running `npx` or `npm install` on every command.** Each npx call costs 3–10s (package resolve, cache EPERM, Node startup). The actual solve is often milliseconds.

| Do once | Reuse every command |
|---------|---------------------|
| Install CLI **one time** to a fixed path | Same `$SP` binary |
| Write `~/.smartplanner/config.json` with backend URL | No repeated `export` |
| Set `$SP` in shell session | All validate/solve/runs commands |

**Never do per task:** `npx @smart-planner/cli ...`, `npm install @smart-planner/cli`, creating throwaway workspaces.

---

## Step 0 — Bootstrap (run only if CLI missing)

### Detect first (always, before any install)

Run **one** check; if CLI responds, **skip install entirely**:

```bash
# A) global
command -v smart-planner >/dev/null 2>&1 && smart-planner --version

# B) repo checkout
test -f cli/dist/index.js && node cli/dist/index.js --version

# C) fixed agent workspace (preferred off-repo)
test -f "$HOME/.smartplanner/cli/node_modules/@smart-planner/cli/dist/index.js" \
  && node "$HOME/.smartplanner/cli/node_modules/@smart-planner/cli/dist/index.js" --version
```

Success = any path prints a version and `runs --help` works. Do **not** compare version strings — if the binary works, use it.

Optional capability check (v3 async API):

```bash
$SP runs --help   # must list status / wait / download
```

### One-time install (only when all checks fail)

Use a **writable fixed directory**, **`@latest`**, and custom npm cache (avoids Windows EPERM):

```bash
CLI_HOME="${SMART_PLANNER_CLI_HOME:-$HOME/.smartplanner/cli}"
NPM_CACHE="${SMART_PLANNER_NPM_CACHE:-$CLI_HOME/.npm-cache}"
mkdir -p "$CLI_HOME" "$NPM_CACHE"

npm install @smart-planner/cli@latest \
  --prefix "$CLI_HOME" \
  --cache "$NPM_CACHE" \
  --no-fund --no-audit
```

Set for the session (and reuse across tasks):

```bash
export SP="node $CLI_HOME/node_modules/@smart-planner/cli/dist/index.js"
$SP --version
$SP runs --help
```

**Alternatives (also one-time):**
- In this repo: `cd cli && npm run build` → `SP="node $(pwd)/cli/dist/index.js"`
- Global: `npm install -g @smart-planner/cli@latest` → `SP=smart-planner`

### Persist backend URL (once, no OAuth)

Agents must **not** run `login` (browser OAuth). Write config directly:

```bash
mkdir -p ~/.smartplanner
cat > ~/.smartplanner/config.json <<'EOF'
{
  "backendUrl": "https://smart-planner-808969362008.us-south1.run.app"
}
EOF
```

CLI reads this automatically. Optional override: `export SMART_PLANNER_BACKEND_URL=...`

**User-only:** `smart-planner login --backend-url <url>` also writes config + session (for quota/OAuth).

---

## Step 1 — Invoke: always `$SP`, never npx

```bash
# After bootstrap — every command looks like:
$SP models list --format json
$SP validate --format json
$SP solve --async --format json
$SP runs status --run-id <id> --format json
```

**Wrong (slow):**
```bash
npx @smart-planner/cli models list          # DON'T — repeats npx overhead every call
npm install @smart-planner/cli              # DON'T — unless bootstrap step 0
```

**Acceptable once** (first bootstrap only): `npm install @smart-planner/cli@latest --prefix $CLI_HOME`

---

## Async solves — do not block

Large solves take minutes. **Never** hold one command until done.

```text
1. $SP solve --async --format json     → save run_id (seconds)
2. $SP runs wait --run-id <id> --timeout 60 --format json
3. exit 2 (still running) → STOP; check again later (next turn / 1–2 min)
4. exit 0 + state=succeeded → $SP runs download --run-id <id> --out-dir ./out
5. Read ./out/*.csv
```

| Exit | Meaning | Action |
|------|---------|--------|
| 0 | `succeeded` | `runs download` |
| 1 | `failed` | Fix CSV/config, new run |
| 2 | still running | **Come back later** — same `run_id` |

---

## Workflow paths

### Fastest — data already in project

Skip discovery entirely:

```bash
cd examples/capacity-planning-demo
$SP validate --format json
$SP solve --async --format json
$SP runs wait --run-id <ID> --timeout 60 --format json
$SP runs download --run-id <ID> --out-dir ./out --format json
```

### Greenfield — new project

```bash
$SP models list --format json                    # pick model_id
$SP models get --model-id <id> --format json      # schema — skip separate spec if this is enough
$SP init --model-id <id> my-project
cd my-project
# edit data/*.csv, config.json
$SP validate --format json
$SP solve --async --format json
# poll → download
```

**Skip `spec`** when `models get --format json` already returns datasets, `config_schema`, constraints, objectives.

---

## Command reference

| Command | When |
|---------|------|
| `models list --format json` | Pick `model_id` |
| `models get --model-id <id> --format json` | Full schema (prefer over `spec`) |
| `init --model-id <id> [dir]` | Scaffold project |
| `validate --format json` | Before solve |
| `solve --async --format json` | **Always for agent solves** |
| `runs status --run-id <id> --format json` | One poll |
| `runs wait --run-id <id> --timeout 60 --format json` | Bounded wait |
| `runs download --run-id <id> --out-dir ./out` | After succeeded |

---

## Agent operating rules

| Rule | Do | Do not |
|------|----|--------|
| **CLI** | Bootstrap once; reuse `$SP` | `npx` on every command |
| **Install** | Only when detect check fails | Install when CLI already works |
| **Version tag** | `@latest` on one-time install | Pin old versions in skill/docs |
| **Backend URL** | `~/.smartplanner/config.json` once | `export` every task (optional override only) |
| **npm cache** | `--cache $CLI_HOME/.npm-cache` on install | Default cache if EPERM |
| **Discovery** | Skip if project exists | Re-run list/spec/init every time |
| **spec** | Skip if `models get` done | Redundant spec after models get |
| **Solve** | `--async` + poll | Blocking solve |
| **Login** | User only on 401/quota | Agent OAuth |

---

## Full session example (optimized)

```bash
# === ONE-TIME (skip if detect check passes) ===
CLI_HOME="$HOME/.smartplanner/cli"
npm install @smart-planner/cli@latest --prefix "$CLI_HOME" --cache "$CLI_HOME/.npm-cache"
echo '{"backendUrl":"https://smart-planner-808969362008.us-south1.run.app"}' > ~/.smartplanner/config.json

# === EVERY SESSION ===
export SP="node $CLI_HOME/node_modules/@smart-planner/cli/dist/index.js"

# === TASK (data ready) ===
cd my-project
$SP validate --format json
$SP solve --async --format json
# save run_id
$SP runs wait --run-id run_xxx --timeout 60 --format json
$SP runs download --run-id run_xxx --out-dir ./out --format json
```

---

## Pre-flight checklist

- [ ] `$SP --version` works (no install if yes)
- [ ] `$SP runs --help` works (confirms v3 async commands)
- [ ] `~/.smartplanner/config.json` exists OR `SMART_PLANNER_BACKEND_URL` set
- [ ] Using `$SP`, not `npx`
- [ ] Solve uses `--async`; `run_id` saved
- [ ] `--out-dir ./out` writable

---

## Anti-patterns

- **Do not** run `npx @smart-planner/cli` for each subcommand
- **Do not** `npm install` when CLI already on disk and working
- **Do not** create new node workspaces per task
- **Do not** pin obsolete package versions — use `@latest` when installing
- **Do not** call `spec` after `models get` with same model_id
- **Do not** blocking `solve` on large problems
- **Do not** tight-loop `runs wait`
- **Do not** agent `login` (browser)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Slow every command | Stop npx; bootstrap once, use `$SP` |
| npm EPERM / safe-delete | `npm install --cache $CLI_HOME/.npm-cache` |
| `Missing backend URL` | Write `~/.smartplanner/config.json` |
| Agent timeout on solve | `solve --async` + `runs wait` with gaps |
| `401` / quota | Ask **user** to `login` |
| Missing `runs` command | Re-install `@latest` (old CLI) |
| `templates list` unknown | Wrong/legacy CLI — reinstall `@latest` |

---

## Related

- Skill path: `.cursor/skills/smart-planner-cli/SKILL.md`
- Example: `examples/capacity-planning-demo/`
- Docs: `docs/cli.md`, `docs/problem_agnostic_api.md`

**Summary:** bootstrap once with `@latest` → `$SP` forever → config once → validate → solve --async → poll with gaps → download.
