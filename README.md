# Optivise CLI

> Give your AI agent real optimization power.

Optivise CLI is a transparent, open-source data pipeline for AI agents. It lets an agent prepare CSV data and configuration, show you the exact request, and call an Optivise model for validation or solving. The CLI is local-first: it does not run a daemon, discover unrelated files, or send telemetry.

The agent prepares the data. You decide what to send. `prepare` prints a JSON solve manifest with the endpoint, model, configuration, selected files, byte counts, hashes, expected writes, and redacted authentication mode. The agent should ask for one final approval immediately before `run`; discovery, mapping, lint, and preparation should not trigger repeated approval pauses.

## What it is

- A small Node.js CLI with canonical command `optivise` and `smart-planner` startup alias.
- Portable agent skills named `optivise-cli` and `smart-planner-cli`.
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
npm install --global @smart-planner/cli@1.0.1
# Workbuddy / Feishu Doubao:
optivise setup --target workpartner
# Codex:
optivise setup --target codex
```

Installing the npm package alone installs only the executable. A complete agent setup is not ready until `optivise setup` reports `ready: true`; it installs both skill aliases and verifies the canonical skill bundle. The setup command never installs a solver and never changes the user directory through npm postinstall.

Agent hosts should invoke the installed package from their managed Node workspace or package runner. Do not create wrapper scripts, edit `.zshrc`/`.bashrc`, or persistently change `PATH` as part of onboarding. After `ready: true`, tell the user only that installation is complete unless they explicitly request technical details.

The package is free to install and MIT-licensed. Hosted solver usage is metered by the Optivise service. Pricing depends on the service plan and is not encoded in this client.

## Agent onboarding prompt

```text
Use $optivise-cli to choose a v3 model/profile, build an explicit mapping, run lint and prepare, summarize the request once, ask for approval, and only then submit an Optivise run.
```

## A transparent run

```bash
optivise describe-models
optivise scaffold --model <immutable-model-id> --profile <profile-id> --project ./project
optivise lint --project ./project
optivise prepare --project ./project --out ./project/manifest.solve.json
# Review manifest.json with the user, then submit the exact approved digest.
optivise run --manifest ./project/manifest.solve.json --approve <manifest_id> --wait 60 --out ./project/results
```

`prepare` reads only named files and performs the public model-descriptor `GET` needed to resolve datasets. It never performs the dataset `POST`, uploads a file, or creates result artifacts. `run` requires an unchanged manifest and explicit approval, then waits and downloads the complete artifact batch by default. If any artifact download fails, no partial batch is published.

## Example

Use `scaffold` with one of the Assignment, Finite-capacity Scheduling, Selection, or Routing profiles. It downloads the authoritative templates and creates the canonical `project.json`, `config.json`, and `mapping.json` files.

## Network and filesystem boundaries

The complete command-by-command behavior is in [`docs/network-behavior.md`](docs/network-behavior.md). In short:

- Model discovery, templates, login, validation, solve submission, run polling, and artifact download are explicit commands.
- Requests use HTTPS, except for `localhost`, `127.0.0.1`, and `::1` development endpoints.
- Requests have a bounded 30-second network timeout.
- Tokens are sent as bearer authorization when logged in and are redacted from manifests and logs.
- Dataset paths must resolve inside the selected data directory. Artifact names must be safe CSV basenames.
- The CLI does not promise how the hosted service handles data after an explicit request. See the [Optivise privacy policy](https://www.optivise.cc/privacy) for service-side terms.

## Audit the source

- [`docs/network-behavior.md`](docs/network-behavior.md)
- [`docs/security-model.md`](docs/security-model.md)
- [`SECURITY.md`](SECURITY.md)
- [`skills/optivise-cli`](skills/optivise-cli)

## Compatibility

The CLI itself is tested on Node.js 18, 20, and 22 in CI. Agent-platform guides are deliberately labeled as tested or setup-only. They describe how an agent can invoke a local command runner; they do not claim that a consumer chat product can execute shell commands without an enabled tool.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Security reports should follow [`SECURITY.md`](SECURITY.md).

Copyright (c) 2026 Optivise.
