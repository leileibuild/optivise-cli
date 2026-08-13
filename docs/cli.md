# Smart Planner CLI (0.3)

Agent-driven **CSV workflow** aligned with the problem-agnostic `/v3` API: discover an immutable model, download templates, validate datasets, solve asynchronously, download result CSVs.

See [Problem-agnostic v3 API](problem_agnostic_api.md) and [OpenAPI v3](../openapi/v3.yaml).

## Quick start

```bash
npx smart-planner login --backend-url http://localhost:8000

npx smart-planner models list --format json
npx smart-planner spec --model-id capacity-planning@sha256:3c52f6d1

npx smart-planner init --model-id capacity-planning@sha256:3c52f6d1 my-project
cd my-project

# edit data/*.csv and config.json
npx smart-planner validate
npx smart-planner solve
```

Inside a scaffolded project, `validate` and `solve` read `model_id`, `dataDir`, and `defaultConfig` from `project.yaml`.

## Agent integration flow

1. `smart-planner models list --format json` — pick an immutable `model_id`
2. `smart-planner spec --model-id <id> --format json` — datasets, fields, config schema, constraints/objectives
3. `smart-planner init --model-id <id>` — download every required CSV template into `data/`
4. Agent fills `data/<dataset>.csv` and `config.json`
5. `smart-planner validate --format json` — `POST /v3/runs` with `mode=validate`; fix errors until `valid: true`
6. `smart-planner solve --format json` — `POST /v3/runs` with `mode=solve`; poll and download artifacts

The server re-validates on every solve; a prior validate run is advisory only.

## Commands

| Command | API | Description |
|---------|-----|-------------|
| `models list [--all]` | `GET /v3/models` | List immutable model revisions |
| `models get [--model-id]` | `GET /v3/models/{id}` | Full model descriptor |
| `models template --model-id --dataset` | `GET /v3/models/{id}/templates/{name}.csv` | Download one template |
| `spec [--model-id]` | descriptor → agent bundle | What to prepare before validate |
| `init --model-id <id>` | templates + scaffold | Create project with CSV templates |
| `validate [--model-id] [--data-dir]` | `POST /v3/runs` validate | Parse, validate, build (no solver) |
| `solve [--model-id] [--data-dir] [--out-dir]` | `POST /v3/runs` solve | Solve + download result CSVs |
| `login` / `whoami` / `logout` | — | Backend URL + Bearer identity |

## Project layout

```text
my-project/
  project.yaml          # model_id, dataDir, defaultConfig, outDir
  config.json           # constraints, objectives, weights, parameters, solver
  data/
    work_items.csv      # one file per required dataset
  results/              # solve output (artifact CSVs)
```

## config.json shape

Matches the v3 configuration envelope (model-specific JSON Schema is authoritative):

```json
{
  "constraints": { "capacity_limit": true },
  "objectives": { "maximize_priority": true },
  "weights": { "maximize_priority": 1.0 },
  "parameters": { "capacity_units": 100 },
  "solver": { "time_limit_seconds": 60, "workers": 4 },
  "extras": {}
}
```

## Authentication

- `login` saves `backendUrl` and registers HMAC identity (`/v1/cli/register`).
- **v3** sends `Authorization: Bearer <client_id>` when the server has `SMART_PLANNER_V3_AUTH_ENABLED=1`; local dev often runs with auth disabled.

## Validation errors

Failed validate runs return structured errors (dataset, line, column, suggestion). Use `--format json` for agent consumption:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "invalid_datetime",
      "message": "due_at must be an ISO 8601 datetime with a timezone",
      "dataset": "jobs",
      "line": 3,
      "column": "due_at",
      "suggestion": "Replace the value with 2026-09-02T17:00:00Z"
    }
  ]
}
```
