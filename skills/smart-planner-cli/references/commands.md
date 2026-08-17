# Commands

```bash
smart-planner models list --format json
smart-planner models get --model-id <model_id> --format json
smart-planner init --model-id <model_id> ./my-project

cd ./my-project
smart-planner validate --dry-run --format json
# show the manifest and obtain approval
smart-planner validate --format json

smart-planner solve --dry-run --out-dir results --format json
# show the manifest and obtain approval
smart-planner solve --out-dir results --format json
```

For long jobs:

```bash
smart-planner solve --dry-run --format json
smart-planner solve --async --format json
smart-planner runs wait --run-id <run_id> --timeout 60 --format json
smart-planner runs download --run-id <run_id> --out-dir results --format json
```

The `--dry-run` command is the approval boundary. It reads the selected files and fetches the model descriptor, but it does not submit a run or write result files.
