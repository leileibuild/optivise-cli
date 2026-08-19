# Network behavior and local side effects

This document is the authoritative map of network-capable commands. No command makes a network request unless listed here.

| Command | Network behavior | Local reads | Local writes |
| --- | --- | --- | --- |
| `describe-models` | `GET /v3/models` | Config and session | None |
| `model-info` / `schema-template` | Descriptor/template `GET` | Config and session | Only explicit output paths |
| `scaffold` | Descriptor `GET` plus one template `GET` per descriptor dataset | Config and session | Canonical project directory and templates |
| `lint` | Descriptor `GET` plus local checks | Project, config, mapping, named data | None |
| `dryrun` | Descriptor `GET` only; never `POST /v3/runs` | Project, config, mapping output, named data | Optional manifest and local manifest store |
| `run` | Repeats descriptor `GET`, verifies the exact manifest, then `POST /v3/runs`; `--wait` polls | Project, config, manifest, named CSV files, session | Run metadata |
| `status` / `runs list` | `GET /v3/runs/{run_id}` or `GET /v3/runs` | Config and session | Local run index |
| `fetch` | Run `GET`, then one artifact `GET` per result | Config and session | Result CSV files under `--out` |
| `cancel` / `recover` | Cancel `POST` or run `GET`; recover never uploads | Config, session, local run index | Local recovery metadata |
| `login` | Device-auth `POST` and token polling `POST` requests | Config | `~/.optivise/config.json` and session data |
| `whoami` | None | Session | None |
| `logout` | None | Session | Deletes the local session |

All requests use the configured backend URL. HTTPS is required except for loopback development addresses. Each request has a 30-second timeout. The client does not attach command metadata or telemetry.

## Dry-run manifest

The manifest is JSON so a user or agent can show it without parsing log text. It contains the target backend and descriptor/submission endpoints, mode, model ID, complete configuration, selected real paths, byte sizes, SHA-256 hashes, expected local writes, authentication mode, and executed versus unexecuted network operations. Bearer tokens never appear in it.

## Service-side handling

The client sends only the named datasets and configuration in an explicit `validate` or `solve` request. The client cannot state what the hosted service retains after processing. Consult the [Optivise privacy policy](https://www.optivise.cc/privacy).
