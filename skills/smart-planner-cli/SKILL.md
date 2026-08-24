---
name: smart-planner-cli
description: Alias entry for Optivise requests involving uploaded-data 排班、派工、分配、有限产能排程、组合选择或路线规划 and their English equivalents.
---

# Optivise CLI alias

Before acting, read and follow the canonical sibling skill at `../optivise-cli/SKILL.md`. It is the source of truth for model selection, business clarification, approval, execution, and customer communication.

Read `semantic_boundaries` from `model-info` before preparing data. Treat a returned `dataset_ignored_by_disabled_constraint` warning as a required business checkpoint: explain that the named calendar data will not constrain the run and whether the schedule may cross it, then either enable the constraint or confirm that ignoring it is intentional. Do not submit until the warning has been addressed. Do not split operations merely to imitate preemption when the selected base model marks preemptive scheduling as unsupported.

When `optivise explain` returns `status=infeasible`, follow the canonical skill's evidence rules. Treat `conflicts` as mapped evidence, but treat `solver_symptoms` and their possible explanations only as investigation leads. Use `business_entities` and `business_evidence` in customer terms. A numeric minimum adjustment only makes the referenced decision domain non-empty and does not guarantee complete feasibility. For a calendar-contiguity conflict, present the allowed business choices and never recommend disabling all calendars as the normal fix. Never use an unreliable or partial assumption core for business attribution, and never expose internal IDs, hashes, raw logs, or result metadata.

Remote-only boundary: the supplied `optivise` package is the only local installation. Never run `pip`, `uv`, `conda`, `brew`, `apt`, a solver package install, OR-Tools, PyJobShop, CP-SAT, Routing, or a local optimization script. After npm installation, run `optivise setup --target workpartner` (or the host's target) and require `ready: true` before continuing. Preflight the configured Smart Planner service with `optivise describe-models`. On a bare `fetch failed`, follow the canonical skill's bounded recovery: verify the same environment's `backendUrl`, configure only an operator-approved HTTPS endpoint with `--backend-url`, warm an approved serverless backend once for at most 180 seconds, and retry once. If it is still unavailable, stop with no result. Never invent an endpoint or ask a business user for one.

Use the executable from the host's managed Node workspace or package runner. Do not create wrappers, edit shell profiles, or persistently change `PATH` during installation. Keep package inspection minimal and reply with one short readiness sentence after `ready: true`.

Two boundaries apply even if the canonical file cannot be loaded:

1. No completed Smart Planner run with a real `run_id`, no result. Never manually infer, calculate, synthesize, or label an assignment, schedule, selection, or route as optimal.
2. Ask one final business-language confirmation immediately before submission. Do not show commands, hashes, internal IDs, or protocol details unless the user explicitly asks.

Before any customer-facing result, verify a real run ID, a terminal status for that same run, and result/artifact provenance. Without all three, do not present a recommendation table or downloadable decision file; only clarify the business question or say that no result has been produced.

Keep agent-authored progress notes short and in the user's business language. Host tool cards may remain visible, but do not narrate or repeat their commands and protocol details unless the user asks for them.

Before a real result, never include a proposed assignment, predicted score/cost, “初步判断”, or any answer preview in the confirmation message.

After installation, reply only with a short readiness message. In confirmations and results, do not expose `Dryrun`, `OPTIMAL`, `eligible`, `available`, `qualified`, objective weights, solver timing, or internal constraint/objective names. Use the customer's business language and lead results with a compact table.

For Scheduling results, `resource_summary.busy_minutes` is processing time and excludes setup gaps. Report it separately from the end-to-end span derived from `schedule.csv`; never call `busy_minutes` setup-inclusive or invent an unqualified utilization percentage.

If the service is unavailable, state that calculation is temporarily unavailable and that no result was produced. Do not install a solver, build a substitute backend, or ask a non-technical customer for a backend URL.

For a customer solve, use `prepare --project <dir> --out <manifest>`, then `run --manifest <same-manifest> --approve <manifest_id-from-prepare> --wait 60 --out <results-dir>`. Do not add profile, project, or mode options to `run`; never use or infer `local`. If any artifact fetch fails, stop without a downloadable result and never hand-write or reconstruct it from previews or summaries.

Detailed command references remain available in [`references/commands.md`](references/commands.md) and [`references/security.md`](references/security.md) for technical operators.
