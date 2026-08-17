# Capacity planning

Allocate a fixed quantity of capacity to prioritized work items.

## CSV workflow

1. Edit CSV files under `data/` (one file per dataset: `<name>.csv`)
2. Adjust `config.json` (constraints, objectives, weights, parameters, solver)
3. Run `smart-planner validate --dry-run --format json` and show the manifest
4. After approval, run `smart-planner validate`
5. Run `smart-planner solve --dry-run --out-dir results --format json` and show the manifest
6. After approval, run `smart-planner solve --out-dir results`

The checked-in input files are safe local fixtures. A real solve requires a configured Optivise backend.
