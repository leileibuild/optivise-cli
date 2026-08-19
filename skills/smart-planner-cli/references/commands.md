# Commands

```bash
optivise describe-models
optivise model-info --model <immutable-id>
optivise scaffold --model <immutable-id> --profile <profile-id> --project ./my-project

optivise lint --project ./my-project
optivise prepare --project ./my-project --out ./my-project/manifest.solve.json
# after one final business confirmation
optivise run --manifest ./my-project/manifest.solve.json --approve <manifest_id> --wait 60 --out ./my-project/results
```

For long jobs:

```bash
optivise status --run <run_id>
optivise explain --run <run_id> --format detailed
```

`prepare` reads the selected files and fetches the model descriptor, but it does not submit a run or write result files. The customer approval boundary is the first solve submission. `run` reads project, model, profile, mode, and files from the approved manifest. A technical operator may still use `dryrun --mode validate` when explicitly needed.

If artifact retrieval fails, the CLI publishes no partial result batch. Retry `fetch`; never recreate files from previews or summaries.
