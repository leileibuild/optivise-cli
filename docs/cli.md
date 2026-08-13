# Smart Planner CLI (0.2)

Agent-driven workflow: your agent reads **spec**, prepares **Excel + YAML**, CLI **validates** and **solves**.

- **cp_sat** templates (standalone_demo): build model locally → remote CP-SAT or `--local` WASM
- **pyjobshop** templates (manufacturing): upload Excel+YAML → **server PyJobShop** → Excel writeback

## Quick start

```bash
npx @smart-planner/cli@0.2 init --template standalone_demo my-project
cd my-project

npx smart-planner spec --template standalone_demo --format json
npx smart-planner validate --template standalone_demo --excel data/sample.xlsx
npx smart-planner solve --template standalone_demo --excel data/sample.xlsx --local

npx smart-planner login --backend-url https://your-backend.run.app
npx smart-planner solve --template standalone_demo --excel data/sample.xlsx
```

## Agent integration flow

1. `smart-planner templates list --format json` — pick template
2. `smart-planner spec --template <id> --format json` — schema, questions, examples, validate rules
3. Agent prepares Excel (+ supplemental.yaml if required)
4. `smart-planner validate --template <id> --excel ... [--config supplemental.yaml] --format json`
5. `smart-planner solve --template <id> --excel ... [--config ...]`

## Commands

| Command | Description |
|---------|-------------|
| `templates list` | List templates with `solve_ready` / `silo` |
| `spec --template <id>` | Agent-readable specification bundle |
| `validate --template <id> --excel <path>` | Local Excel/YAML validation |
| `init --template <id> [dir]` | Scaffold `project.yaml` + samples |
| `solve --template <id> --excel <path>` | Validate → solve → write Excel |
| `login` / `whoami` / `logout` | HMAC identity |

## Project layout

```text
my-project/
  project.yaml          # template_id, defaultExcel, defaultConfig
  data/sample.xlsx
  supplemental.yaml     # manufacturing only
```

## Server APIs (PyJobShop)

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/templates` | Template metadata |
| `POST /v1/solve/template` | Excel+YAML → server PyJobShop → excel_b64 |
| `POST /v1/solve/model` | cp_sat proto (standalone) |

Auth: same HMAC as 0.1 (`X-Client-Id`, `X-Timestamp`, `X-Signature`).

## Templates

| template_id | silo | solve_ready |
|-------------|------|-------------|
| standalone_demo | cp_sat | yes |
| manufacturing | pyjobshop | yes (server) |
| multi_workshop | pyjobshop | preview |
| labor_scheduling | pyjobshop | preview |
| jspp | pyjobshop | preview |
