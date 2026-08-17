# Migration from the Smart Planner monorepo

The public repository is `leileibuild/optivise-cli`. The npm package remains `@smart-planner/cli`, the command remains `smart-planner`, and the skill remains `smart-planner-cli`.

1. Install `@smart-planner/cli@0.4.0` from the standalone package.
2. Keep `project.yaml`, `config.json`, and `data/<dataset>.csv` in the same project shape.
3. Run `validate --dry-run`, show the manifest, and get approval before submitting.
4. Replace references to the monorepo `cli/` path with the installed `smart-planner` command.
5. Remove any old `identity.json`; `smart-planner logout` performs this cleanup.

The backend API and model IDs are unchanged by this extraction. Historical monorepo design documents may continue to mention the old layout, but new publishing belongs to this repository.
