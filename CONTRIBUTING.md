# Contributing

Thanks for helping keep the CLI small and auditable.

## Before you open a pull request

1. Run `npm ci` and `npm test`.
2. Run `npm run test:package` and inspect the dry-run package file list.
3. Run the skill validator: `python3 "$CODEX_HOME/skills/.system/skill-creator/scripts/quick_validate.py" skills/smart-planner-cli` when the Codex skill tooling is available.
4. Add or update tests for network, path, authentication, and dry-run behavior.
5. Keep claims in documentation tied to observable client behavior.

Do not add telemetry, background processes, broad file discovery, or hidden network requests. A new network-capable command needs an entry in `docs/network-behavior.md` and a test that identifies its method and endpoint.

## Style

Use TypeScript with strict checking, explicit names, and small functions. Prefer standard-library APIs. Avoid unrelated refactors and generated output. Keep the agent skill portable and put detailed security guidance in its references rather than hiding it in prose.

## Changes to the hosted API

The backend is maintained outside this repository. Client changes should remain compatible with the public `/v3` descriptor and run contract, include a fixture or mock response, and explain any changed request shape in the pull request.
