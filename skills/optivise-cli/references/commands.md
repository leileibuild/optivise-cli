# Commands

## Connectivity recovery for technical operators

Run configuration and preflight in the same agent environment and through the same installed package invocation:

```bash
optivise configure --backend-url <approved-https-backend-url>
curl --fail --silent --show-error --max-time 180 <approved-https-backend-url>/health
optivise describe-models
```

The saved configuration is `${OPTIVISE_HOME}/config.json` when `OPTIVISE_HOME` is set, otherwise `~/.optivise/config.json`, and must contain a non-empty `backendUrl`. Agent sandboxes do not necessarily share this file with the user's terminal. A bare `fetch failed` is not enough to distinguish missing configuration from serverless cold start or a real outage. Warm once and retry once; if model discovery still fails, stop with no result. Use `--backend-url`, never `--backend`, and never invent an endpoint or ask a non-technical business user to supply one.

Use this canonical solve sequence after the business meaning and mapping are clear:

```bash
optivise describe-models
optivise model-info --model <immutable-id>
optivise scaffold --model <immutable-id> --profile <profile-id> --project ./optivise-project
optivise convert --project ./optivise-project --input <source.csv> --mapping ./optivise-project/mapping.json
optivise lint --project ./optivise-project
optivise prepare --project ./optivise-project --out ./optivise-project/manifest.solve.json
# after one final business confirmation
optivise run --manifest ./optivise-project/manifest.solve.json --approve <manifest_id> --wait 60 --out ./optivise-project/results
optivise explain --run <run_id> --format short
```

When the run is infeasible, `explain` returns `infeasibility_diagnosis` instead of key decisions and result artifacts. Both formats distinguish business-mapped `conflicts` from unmapped `solver_symptoms`; neither exposes raw solver logs, model files, proto indices, assumption group names, diagnostic hashes, or internal result metadata.

`prepare` fingerprints a solve request without submitting a run. `run` reads project, model, profile, mode, and files from that manifest and downloads the completed artifact batch. Do not add those options manually. There is no local mode.

Inspect `semantic_boundaries` in `model-info` before creating canonical data. Both `lint` and `prepare` return a top-level `warnings` array. `dataset_ignored_by_disabled_constraint` is non-blocking at the CLI level but must be handled before business approval: its `dataset`, `constraint`, `business_impact`, and `suggestion` fields explain which supplied input is ignored and what choice is required.

If the wait expires, continue with `status`, `fetch`, and `explain` using the returned `run_id`. If artifact retrieval fails, stop with no downloadable result and retry `fetch`; never recreate an artifact from previews or summaries.

Keep the task in one of these internal states: `unconfigured`, `preflight_ok`, `prepared`, `approved`, `submitted`, `fetched`. Only `fetched` permits a recommendation, decision table, feasibility claim, objective value, chart, or downloadable result. Data readers and charts used before that state are metadata/preparation only and must not be shown as a solution.
