---
name: smart-planner-cli
description: |
  Use the Optivise CLI (@smart-planner/cli) as a transparent, approval-first optimization pipeline.
  The agent prepares named CSV files and JSON configuration, runs --dry-run, shows the manifest,
  obtains explicit user approval, and only then runs validate or solve. The CLI is foreground-only.
---

# Optivise CLI agent workflow

Use `$smart-planner-cli` when a user wants an optimization model run through `smart-planner`.

## Required approval flow

1. Detect an existing `smart-planner` installation. Install `@smart-planner/cli@0.4.0` once if it is missing.
2. Read `project.yaml`, `config.json`, and the selected `data/*.csv` files in one batch.
3. Run `smart-planner validate --dry-run --format json` or `smart-planner solve --dry-run --format json`.
4. Show the complete JSON manifest. Explain the endpoint, model, configuration, named files, sizes, hashes, expected writes, and authentication mode.
5. Ask the user to approve this exact request. Do not infer approval from a prior task.
6. After approval, run the matching `validate` or `solve` command. Use `--async` for a long job, then `runs wait` and `runs download`.
7. Return the solver status, run ID, summary, and local output paths. Do not claim backend deletion or retention.

Do not use `npx` for every subcommand. Reuse the installed binary. Do not run login unless the user chooses it after an authentication or quota error. Do not search unrelated directories or invent a dataset.

## Choosing sync or async

- Small, known jobs: use synchronous `solve --wait-timeout 30`.
- Larger jobs, a long solver limit, or a prior timeout: use `solve --async`, then `runs wait --timeout 60` and `runs download`.
- Run `validate` when data or configuration changed, or when the model requires a validation pass.

## References

- [Command examples](references/commands.md)
- [Security and approval details](references/security.md)

## Platform guides

Platform-specific setup notes live in [`examples/agents`](../../examples/agents). They are labeled `tested locally` or `setup guidance only`; never imply that a chat product can execute shell commands without an enabled tool.
