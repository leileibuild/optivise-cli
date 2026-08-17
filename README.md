# Optivise CLI

> Give your AI agent real optimization power.

Optivise CLI is a transparent, open-source data pipeline for AI agents. It lets an agent prepare CSV data and configuration, show you the exact request, and call an Optivise model for validation or solving. The CLI is local-first: it does not run a daemon, discover unrelated files, or send telemetry.

The agent prepares the data. You decide what to send. `--dry-run` prints a JSON manifest with the endpoint, model, configuration, selected files, byte counts, hashes, expected writes, and redacted authentication mode. Only after you approve that manifest should the agent run `validate` or `solve`.

## What it is

- A small Node.js CLI with one command, `smart-planner`.
- A portable agent skill named `smart-planner-cli`.
- A CSV and JSON pipeline for immutable Optivise model descriptors.
- Open source under the MIT License and auditable on GitHub.

## What it is not

- Not a daemon, monitoring process, scheduler, or agent replacement.
- Not a data collector and not a background service.
- Not a telemetry or analytics client.
- Not autonomous operational authority. The agent and user choose the payload and command.
- Not a closed solver implementation. The hosted Optivise service performs the metered solve.

## Install

```bash
npm install --global @smart-planner/cli@0.4.0
smart-planner --help
```

The package is free to install and MIT-licensed. Hosted solver usage is metered by the Optivise service. Pricing depends on the service plan and is not encoded in this client.

## Agent onboarding prompt

```text
Use $smart-planner-cli to inspect my planning data, run --dry-run, show me the JSON manifest, ask for approval, and only then submit an Optivise validation or solve.
```

## A transparent run

```bash
smart-planner validate --dry-run --format json
# Review the manifest with the user.
smart-planner validate --format json

smart-planner solve --dry-run --out-dir results --format json
# Review the manifest with the user.
smart-planner solve --out-dir results --format json
```

`validate` and `solve` read the named CSV files and configuration locally. They send those files only when the corresponding command is explicitly run. `--dry-run` performs the public model-descriptor `GET` needed to resolve datasets, but never performs the dataset `POST`, never uploads a file, and never creates result artifacts.

## Example

See [`examples/capacity-planning`](examples/capacity-planning) for a small fixture, including a shared `work_items.csv`, a configuration file, and the expected solver output shape. The fixture is suitable for local smoke tests with a configured backend.

## Network and filesystem boundaries

The complete command-by-command behavior is in [`docs/network-behavior.md`](docs/network-behavior.md). In short:

- Model discovery, templates, login, validation, solve submission, run polling, and artifact download are explicit commands.
- Requests use HTTPS, except for `localhost`, `127.0.0.1`, and `::1` development endpoints.
- Requests have a bounded 30-second network timeout.
- Tokens are sent as bearer authorization when logged in and are redacted from manifests and logs.
- Dataset paths must resolve inside the selected data directory. Artifact names must be safe CSV basenames.
- The CLI does not promise how the hosted service handles data after an explicit request. See the [Optivise privacy policy](https://www.optivise.cc/privacy) for service-side terms.

## Audit the source

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/data-flow.md`](docs/data-flow.md)
- [`docs/security-model.md`](docs/security-model.md)
- [`SECURITY.md`](SECURITY.md)
- [`skills/smart-planner-cli`](skills/smart-planner-cli)

## Compatibility

The CLI itself is tested on Node.js 18, 20, and 22 in CI. Agent-platform guides are deliberately labeled as tested or setup-only. They describe how an agent can invoke a local command runner; they do not claim that a consumer chat product can execute shell commands without an enabled tool.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Security reports should follow [`SECURITY.md`](SECURITY.md).

Copyright (c) 2026 Optivise.
