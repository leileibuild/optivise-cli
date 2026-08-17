# Network behavior and local side effects

This document is the authoritative map of network-capable commands. No command makes a network request unless listed here.

| Command | Network behavior | Local reads | Local writes |
| --- | --- | --- | --- |
| `models list` | `GET /v3/models` | Config and session | None |
| `models get` | `GET /v3/models/{model_id}` | Config and session | None |
| `models template` | `GET /v3/models/{model_id}/templates/{dataset}.csv` | Config and session | The explicit `--out` CSV, or `<dataset>.csv` |
| `spec` | `GET /v3/models/{model_id}` | Config, project, session | None |
| `init` | Descriptor `GET` plus one template `GET` per descriptor dataset | Config and session | The selected project directory, templates, `project.yaml`, `config.json`, and README |
| `validate --dry-run` | Descriptor `GET` only | Project, config, required CSV files | None |
| `validate` | Descriptor `GET`, then `POST /v3/runs` with named CSV files and configuration. Async mode may poll `GET /v3/runs/{run_id}`. | Project, config, CSV files, session | None |
| `solve --dry-run` | Descriptor `GET` only | Project, config, required CSV files | None |
| `solve` | Descriptor `GET`, then `POST /v3/runs`; sync mode polls; solve artifacts use `GET /v3/runs/{run_id}/artifacts/{artifact_id}` | Project, config, CSV files, session | Result CSV files under `--out-dir` |
| `runs status` | `GET /v3/runs/{run_id}` | Config and session | None |
| `runs wait` | Repeated `GET /v3/runs/{run_id}` until terminal or timeout | Config and session | None |
| `runs download` | Run `GET`, then one artifact `GET` per result | Config and session | Result CSV files under `--out-dir` |
| `login` | Device-auth `POST` and token polling `POST` requests | Config | `~/.smartplanner/config.json` and `session.json` |
| `whoami` | None | Session | None |
| `logout` | None | Session and legacy identity path | Deletes session and any old `identity.json` |

All requests use the configured backend URL. HTTPS is required except for loopback development addresses. Each request has a 30-second timeout. The client does not attach command metadata or telemetry.

## Dry-run manifest

The manifest is JSON so a user or agent can show it without parsing log text. It contains the target backend and descriptor/submission endpoints, mode, model ID, complete configuration, selected real paths, byte sizes, SHA-256 hashes, expected local writes, authentication mode, and executed versus unexecuted network operations. Bearer tokens never appear in it.

## Service-side handling

The client sends only the named datasets and configuration in an explicit `validate` or `solve` request. The client cannot state what the hosted service retains after processing. Consult the [Optivise privacy policy](https://www.optivise.cc/privacy).
