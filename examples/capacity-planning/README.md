# Capacity planning

Allocate a fixed quantity of capacity to prioritized work items.

## CSV workflow

1. Edit CSV files under `data/` (one file per dataset: `<name>.csv`)
2. Adjust `config.json` (constraints, objectives, weights, parameters, solver)
3. `smart-planner validate`
4. `smart-planner solve`
