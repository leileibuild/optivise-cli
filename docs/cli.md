# Smart Planner CLI (0.2)

Agent-driven workflow: discover an immutable **model**, prepare **CSV datasets**, CLI **validates** and **solves** via the problem-agnostic `/v3` API. Legacy Excel templates remain available for local development.

## Quick start (v3 CSV workflow)

```bash
npx smart-planner login --backend-url http://localhost:8000

npx smart-planner models list --format json
npx smart-planner models get --model-id capacity-planning@sha256:3c52f6d1

npx smart-planner init --model-id capacity-planning@sha256:3c52f6d1 my-project
cd my-project

npx smart-planner validate --model-id capacity-planning@sha256:3c52f6d1 --data-dir data
npx smart-planner solve --model-id capacity-planning@sha256:3c52f6d1 --data-dir data --out-dir results
```

See [Problem-agnostic v3 API](problem_agnostic_api.md) and [OpenAPI v3](../openapi/v3.yaml).

## Agent integration flow (v3)

1. `smart-planner models list --format json` — pick an immutable `model_id`
2. `smart-planner models get --model-id <id> --format json` — datasets, config schema, constraints/objectives
3. `smart-planner init --model-id <id>` — download CSV templates into `data/`
4. Agent fills CSV files and `config.json`
5. `smart-planner validate --model-id <id> --data-dir data --format json`
6. `smart-planner solve --model-id <id> --data-dir data --out-dir results`

Validation and solve use `POST /v3/runs` with `mode=validate` or `mode=solve`. Poll `GET /v3/runs/{run_id}` until `state` is `succeeded` or `failed`. Result CSVs download from `GET /v3/runs/{run_id}/artifacts/{artifact_id}`.

## Legacy template workflow (Excel)

```bash
npx @smart-planner/cli@0.2 init --template standalone_demo my-project
cd my-project

npx smart-planner spec --template standalone_demo --format json
npx smart-planner validate --template standalone_demo --excel data/sample.xlsx
npx smart-planner solve --template standalone_demo --excel data/sample.xlsx --local
```

## Commands

| Command | Description |
|---------|-------------|
| `models list` | `GET /v3/models` |
| `models get --model-id <id>` | Model descriptor + config schema |
| `models template --model-id <id> --dataset <name>` | Download one CSV template |
| `init --model-id <id>` | Scaffold v3 project with CSV templates |
| `validate --model-id <id> --data-dir <path>` | Remote v3 validation run |
| `solve --model-id <id> --data-dir <path>` | Remote v3 solve + artifact download |
| `templates list` | Built-in local templates (legacy) |
| `spec --template <id>` | Agent-readable template spec |
| `validate --template <id> --excel <path>` | Local Excel/YAML validation |
| `init --template <id>` | Scaffold Excel template project |
| `solve --template <id> --excel <path>` | Template solve (local WASM or v1 remote) |
| `login` / `whoami` / `logout` | Identity + v1 HMAC registration |

## Project layout (v3)

```text
my-project/
  project.yaml          # model_id, dataDir, defaultConfig
  config.json           # constraints, objectives, weights, parameters, solver
  data/
    work_items.csv
  results/              # solve output artifacts
```

## Authentication

- **v3:** `Authorization: Bearer <client_id>` when `SMART_PLANNER_V3_AUTH_ENABLED=1` on the server; otherwise anonymous for local dev.
- **v1 (legacy remote CP-SAT / template solve):** HMAC headers from `login` (`X-Client-Id`, `X-Timestamp`, `X-Signature`).

## Server APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /v3/models` | List immutable models |
| `GET /v3/models/{model_id}` | Model descriptor |
| `GET /v3/models/{model_id}/templates/{dataset}.csv` | Input template |
| `POST /v3/runs` | Validate or solve (multipart CSV + JSON request) |
| `GET /v3/runs/{run_id}` | Poll run state |
| `GET /v3/runs/{run_id}/artifacts/{id}` | Download result CSV |
| `POST /v1/solve/model` | Legacy cp_sat proto |
| `POST /v1/solve/template` | Legacy Excel+YAML PyJobShop |
