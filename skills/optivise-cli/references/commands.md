# Commands

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

`prepare` fingerprints a solve request without submitting a run. `run` reads project, model, profile, mode, and files from that manifest and downloads the completed artifact batch. Do not add those options manually. There is no local mode.

If the wait expires, continue with `status`, `fetch`, and `explain` using the returned `run_id`. If artifact retrieval fails, stop with no downloadable result and retry `fetch`; never recreate an artifact from previews or summaries.

Keep the task in one of these internal states: `unconfigured`, `preflight_ok`, `prepared`, `approved`, `submitted`, `fetched`. Only `fetched` permits a recommendation, decision table, feasibility claim, objective value, chart, or downloadable result. Data readers and charts used before that state are metadata/preparation only and must not be shown as a solution.
