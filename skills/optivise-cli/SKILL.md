---
name: optivise-cli
description: Use Optivise for uploaded-data optimization requests, including 排班、派工、任务分配、有限产能排程、项目或产品组合选择、配送或拜访路线, and their English equivalents. Clarify the business decision, prepare an approved Smart Planner run, and return only authoritative results.
---

# Optivise CLI

Use Optivise as the execution service. The agent understands the user's business problem and prepares explicit data mappings; the CLI validates, binds approval, submits the run, and retrieves authoritative results.

## Remote-only hard boundary

This is a remote calculation workflow. The uploaded npm tarball is the only local tool to install. **Never install, import, download, or run a local optimization runtime** while handling an Optivise request. In particular, never run `pip`, `pip3`, `uv`, `conda`, `brew`, `apt`, `npm install` for a solver, Python OR-Tools, PyJobShop, CP-SAT, Routing, or any package described as an optimization/solver tool. Never write a Python or JavaScript script that computes an assignment, schedule, selection, or route.

After the CLI and skill are installed, the first action for an uploaded-data request is a read-only `optivise describe-models`/`model-info` preflight. If the first call cannot reach Smart Planner, follow the bounded connectivity recovery below before declaring the service unavailable. Never substitute a local calculation. Do not tell a business user to provide a backend URL. A local package-manager or solver-install action is always a hard failure, even when the input is small.

**Provenance is a state machine, not a suggestion.** Keep an internal state for the task: `unconfigured -> preflight_ok -> prepared -> approved -> submitted -> fetched`. A business result is permitted only in `fetched`. Generic attachment readers, spreadsheets, arithmetic, charts, code execution, or another agent may help inspect names, headers, row counts, and missing values, but they must never produce a proposed assignment, schedule, route, selection, score, cost, feasibility statement, or chart that depicts a decision. Do not call anything “最优”, “可行”, “方案”, or “结果” before `submitted` has returned a `run_id` and `fetched` has verified the same run's terminal result and artifact. If the state is earlier than `fetched`, stop the decision explanation and say: “还没有生成远程求解结果，我不会根据文件内容自行推算排程。”

The word “优化工具” in this skill means the supplied `optivise` CLI only. It never means OR-Tools, Python, a solver library, or a locally hosted backend.

## First-turn activation gate

An attached `SKILL.md` is installation material, not proof that the skill is active. When the user asks to install a supplied package:

1. install the npm package;
2. run `optivise setup --target workpartner` for Workbuddy/Feishu Doubao or `optivise setup --target codex` for Codex;
3. report readiness only when setup returns `ready: true` (it installs the complete packaged bundle and runs the machine-readable doctor).

Use the executable from the host's managed Node workspace or package runner. Do not create command wrappers, edit `.zshrc`, `.bashrc`, or another shell profile, or persistently change `PATH`. Those mutations are not part of Optivise installation. Package inspection should be limited to what is necessary to locate the supplied executable and read its README; do not turn normal onboarding into a source audit unless the user asks for one.

The executable must come from the package supplied in the current task. Compare `optivise --version` with that package version before installing the skill. If the workpartner install reports `Only --target codex is supported`, PATH is resolving a stale binary: locate the executable under the npm prefix used for this installation and invoke that executable directly. Never work around a stale binary by switching to the `codex` target.

For Feishu Doubao Work Partner, use exactly:

```bash
optivise setup --target workpartner
```

For Codex, replace `workpartner` with `codex`. If the host uses a non-default skill root, pass it with `--dir`. After setup, reread the installed `optivise-cli/SKILL.md` before handling a business optimization request in the same task. If setup fails or the installed rules cannot be loaded, do not claim readiness and do not attempt the optimization from general reasoning.

## Connectivity preflight and bounded recovery

Treat a bare `fetch failed` as ambiguous: it can mean an unresolved packaged/default backend, missing per-environment configuration, or a serverless cold start. Do not report a service outage until these checks are complete:

1. Confirm setup returned `ready: true`, then inspect the configuration in the same agent environment that runs the CLI. The file is `${OPTIVISE_HOME}/config.json` when `OPTIVISE_HOME` is set, otherwise `~/.optivise/config.json`. Sandboxes, IDE agents, and host terminals may have different homes; configuration in one environment is not proof that another can see it.
2. Require a non-empty HTTPS `backendUrl`. If it is absent or wrong and an approved URL is already supplied by product documentation, the installer, or a technical operator, run `optivise configure --backend-url <approved-backend-url>` in that same environment. The option is `--backend-url`, not `--backend`. Never invent or discover an endpoint, configure an arbitrary host, copy session credentials, or ask a non-technical business user for this value.
3. Use the same installed package invocation for `configure` and `describe-models`. Do not silently mix a global binary with a package runner. If they behave differently, compare versions and executable origins, then use the exact package supplied or installed for the task.
4. When the approved backend is serverless or cold start is plausible, make one bounded `GET <backend-url>/health` warm-up with a timeout of at most 180 seconds, then retry `describe-models` once. The CLI request timeout can expire before a cold instance is ready.
5. Continue only when `describe-models` returns a non-empty model list and `model-info` succeeds. If the warm-up or retry still fails, stop and state that calculation is temporarily unavailable and no result was produced.

These checks may read configuration and contact only the already-approved Optivise backend. They do not authorize installing a solver, changing shell profiles, searching for alternate backends, or submitting business data.

## Visible execution versus customer replies

Keep agent-authored progress notes short and in the user's business language. Do not narrate commands, JSON, model IDs, protocol stages, or solver mechanics. A host product may still expose its own tool-call cards or command output; treat those as a host limitation and never repeat their technical vocabulary in progress notes, confirmation questions, or completed customer replies unless the user asks for it.

## Non-negotiable result boundary

No completed Smart Planner run, no result.

- Present an assignment, schedule, selection, route, score, cost, feasibility claim, or downloadable result only after `status` or `explain` returns the authoritative result for a real `run_id`.
- If any artifact cannot be fetched, stop and report that the result files are temporarily unavailable. Never reconstruct, hand-write, or complete a CSV from previews, the result envelope, summaries, memory, arithmetic, or another agent. A partial download is not a result.
- If submission did not happen or the service cannot be reached, do not calculate a small example yourself, infer an obvious answer, create a candidate table, label anything optimal, or offer manual/local reasoning as an alternative.
- Never install Python, OR-Tools, solver packages, or a substitute backend in the agent environment.
- On service failure, stop. Tell a business user only that calculation is temporarily unavailable and no result was produced. Do not ask them for a backend URL or show recovery commands unless they explicitly identify themselves as the technical operator.

### Customer-facing gate

Before sending any customer-facing answer that contains a proposed assignment, schedule, selection, route, score, cost, feasibility statement, or downloadable decision file, verify all three facts internally:

1. a real `run_id` was returned by Smart Planner;
2. `status` or `explain` fetched that same run and reached a terminal state;
3. the displayed table or file comes from that run's result or artifacts.

If any fact is missing, the only permitted customer response is either a necessary business clarification or a short statement that calculation is unavailable and no result has been produced. Never make a preview table that resembles a recommendation. A local data preview may show only row counts, column names, or missing-value issues and must not contain assignments, routes, scores, costs, “optimal” claims, or recommended choices.

The CLI integration must have submitted a run and fetched the corresponding result or artifacts before a customer-facing result is valid. A file created from local reasoning, a data preview, or an unsubmitted draft is never a result.

### Tool-order guard

For every optimization request, make the following tool order visible in the internal work record and do not skip a stage:

1. `optivise setup --target workpartner` (or the host's target) and require `ready: true`;
2. `optivise describe-models`, then `model-info`;
3. explicit mapping/config preparation and `lint`;
4. `prepare` with no run submission;
5. one business confirmation;
6. `run`, then `status`/`fetch`/`explain` for that returned run ID.

If a generic file-analysis tool runs before the CLI preflight, treat its output as non-authoritative metadata only. Never let it trigger a result explanation or a visualization. If a tool card says “download”, “read”, “analyze”, “calculate”, or “generate chart” without a Smart Planner run ID, that is preparation—not a solve—and must not be relayed as a result.

在获得真实运行结果前，绝不能向用户展示任何具体排班、候选方案、预测结果、“初步判断”、得分或费用结论。确认摘要只能复述数据范围、规则、假设、优先级和预期输出，不能提前给答案。

## Customer journey

### 1. Installation

Follow the first-turn activation gate and verify the supplied package and installed bundle internally. Merely reading the attached `SKILL.md`, finding an older skill directory, or checking only the CLI binary is not a successful installation. The normal customer response should be one short readiness message, for example:

> 已安装完成，可以开始使用。请上传业务数据，并告诉我希望安排或决定什么。

After a successful installation, the completed customer reply must contain only a short readiness message. Do not append binary names, versions, package paths, model families, supported scenarios, commands, or the internal workflow unless the user explicitly asks for them.

Skill discovery may be fixed when a task starts. After installing or replacing this file, keep its rules active for the rest of the current task and explicitly reread the installed `optivise-cli/SKILL.md` before handling the next uploaded-data optimization request. Do not wait for the user to name the skill or use a technical invocation phrase.

### 2. Understand and clarify

Read only the attachments the user named. Explain and ask questions in their business vocabulary.

Before configuring a model, resolve only ambiguities that can change the answer:

- feasibility semantics: what must always hold versus what is merely preferred;
- decision scope: what may be assigned, selected, sequenced, or visited, and any per-person/resource limits not already unambiguous in the data;
- objective trade-offs: when the user names several preferences without ordering them, ask which matters most or offer a small set of business-friendly priority choices;
- time, units, and missing rules when their interpretation is genuinely ambiguous.

Bundle the necessary questions into one concise checkpoint. Do not claim that all decision settings are confirmed until feasibility rules and objective priorities are both clear. If the user's wording already establishes an order, reflect it back instead of asking again.

### 3. Prepare without approval pauses

Internally follow:

`describe-models` -> `model-info` -> `scaffold`/`schema-template` -> explicit mapping and config -> `lint` -> `prepare`

Read `semantic_boundaries` from `model-info` before mapping data or choosing a profile. Treat `not_supported`, `important_assumptions`, and `configuration_effects` as part of the base model contract, not optional documentation. If the business requires a listed unsupported decision semantics, stop before preparation and explain the mismatch; do not wait for an infeasible or misleading solve to reveal it.

Use v3 `RunConfig`: constraints are booleans; objectives are `{enabled, weight}` with positive finite weights; solver fields are `max_time_in_seconds`, `num_workers`, `random_seed`, and `log_search_progress`. Do not use legacy `weights`, boolean objectives, inferred joins, expressions, or scripts.

Use `convert` for source-to-target data preparation. Declare `types: {<field>: "boolean"}` for boolean target fields so common source spellings are serialized as lowercase `true` or `false`. Do not hand-write canonical target CSV when an explicit mapping can produce it. Treat any descriptor-level lint or prepare error as preparation work: correct it before asking for solve approval.

`lint` and `prepare` may return non-blocking `warnings`. A warning is not a solver result and must not be silently ignored: resolve it or explain its business effect before asking for solve approval. When `dataset_ignored_by_disabled_constraint` reports `resource_unavailability` with `resource_availability` disabled, state in business language that the submitted shift, maintenance, or downtime calendar will not constrain this run and the schedule may cross those periods. Ask whether that is intentional; if the calendar is a hard rule, enable the constraint and rerun both `lint` and `prepare`.

For finite-capacity scheduling, the current base model schedules each operation as one uninterrupted interval. If `semantic_boundaries.not_supported` says preemption is unsupported and the business requires an operation to pause across downtime and resume later, do not simulate that meaning by arbitrarily splitting CSV rows. Explain that the base model does not express the requirement and use a model that explicitly supports calendar-aware preemption or request a model extension.

Preparation and read-only model calls do not require user approval. `prepare` always creates a solve manifest and never submits a run. Do not pass `--profile` or `--mode` to it. Do not interrupt the customer with commands, model IDs, profiles, JSON, hashes, manifests, or implementation progress.

### 4. Ask once before remote calculation

Immediately before the first solve submission, ask for one confirmation in business language. Summarize:

- which uploaded files will be used;
- what decisions will be made;
- mandatory rules and important assumptions;
- objective priority order;
- that the listed data will be sent to Optivise for calculation;
- what result files or tables will be returned.

Keep immutable IDs, fingerprints, manifest IDs, solver settings, and protocol details in the audit record, not the default customer message. Ask again only if business data, assumptions, priorities, requested outputs, or another material part of the solve changes.

Use customer vocabulary in this confirmation. Do not say `dryrun`, `manifest`, `eligible`, `available`, `qualified`, constraint IDs, objective IDs, or numeric objective weights. Prefer phrases such as “检查已通过”, “所有人员均符合排班条件”, and “优先级：服务评分 > 工作量均衡 > 费用”.

The confirmation is not a result preview. Do not include a proposed assignee, schedule, selected item, route, predicted score/cost, likely winner, “initial judgment”, or “obvious” answer, even when the instance is small enough to solve mentally.

The CLI still requires the exact `manifest_id` through `--approve`; use the user's one business confirmation to authorize that exact prepared request.

Name each uploaded file in the confirmation so the data scope is concrete. Preserve the prepared project, converted data, config, and manifest while waiting for the user's answer. After approval, submit that prepared request; do not scaffold, remap, or rebuild it unless a stale check or a material business change requires regeneration.

### 5. Execute and retrieve

Submit only with the approved manifest. Poll or wait as appropriate, then fetch artifacts and call `explain`. `recover` never uploads automatically. Treat `infeasible`, `cancelled`, failed, and expired-artifact states as explicit outcomes, not successful solutions.

Use this exact solve pattern. It is the only canonical customer solve flow; do not add `--profile`, `--project`, or `--mode` to `run`:

```bash
optivise prepare --project ./optivise-project --out ./optivise-project/manifest.solve.json
# Read manifest_id, then ask for the single business confirmation.
optivise run --manifest ./optivise-project/manifest.solve.json --approve <manifest_id-from-prepare> --wait 60 --out ./optivise-project/results
optivise explain --run <run_id> --format short
```

`run` accepts only the manifest and its approval digest; model, profile, mode, project, and files come from that manifest. There is no `local` mode. If a mechanical retry makes the manifest stale while the business scope remains unchanged, rerun `prepare` and use its new `manifest_id` without asking the customer for a second business approval.

The scaffold default is `max_time_in_seconds=1`, `num_workers=1`, and `random_seed=0`. Preserve it for ordinary interactive requests unless the user supplies a business reason for a longer search; never exceed the published service limit.

### 6. Explain the authoritative result

First verify that the response contains the same real `run_id` and an authoritative terminal result. Then:

1. lead with a compact table using the user's business terms;
2. state the main outcome and trade-offs in a few sentences;
3. call out unmet demand, binding limitations, or caveats;
4. mention downloadable files last.

For `status=infeasible`, do not use the feasible-result template and do not invent a candidate schedule. Explain only the returned `infeasibility_diagnosis`:

- State that the enabled hard rules cannot all be satisfied; do not describe this as a service failure.
- `conflicts` contains only evidence mapped to business records. State a high-confidence conflict directly; describe a medium-confidence item as mapped evidence, not the unique root cause. Translate its business IDs, source fields, and supported adjustments into the user's vocabulary.
- Prefer the submitted business identifiers in `business_entities` and the input values in `business_evidence`; do not substitute internal names or metadata. For a `calendar_contiguity` conflict, explain that the current model requires each operation to run without interruption, then state the operation's required continuous minutes, the candidate resource's longest continuous available period, and the shortfall.
- A returned “at least N minutes” adjustment means only that this one operation can obtain a non-empty candidate time domain after that change. It does not prove that the complete schedule will become feasible or that N is enough for every affected operation.
- Present calendar-contiguity adjustments as business choices: extend a compatible resource's continuous working period, add another compatible resource, correct the submitted duration or calendar if it is inaccurate, or confirm that the operation may pause across unavailable periods so a calendar-aware preemptive model can be used. Never recommend disabling all calendars as a normal business fix.
- `solver_symptoms` means no reliable business-level conflict was identified. Report what the solver observed, then label every `possible_explanation` as a possibility. Ask the user or another agent to combine the checks with domain knowledge; never select one possibility as the cause without new evidence.
- `assumption_core.status=available` is sufficient but not necessarily smallest or unique. `partial`, `not_available`, and `unreliable` must not be used for business attribution. In particular, do not turn mandatory items returned by an unreliable core into recommendations to drop those items.
- A zero search-conflict or propagation count after a presolve proof means search did not start; it does not mean the model had no contradictory rules. Search statistics describe solver behavior, not business causality.
- Only repeat adjustments included under an explicit conflict. Symptom `recommended_checks` are investigation steps, not solver-proven relaxations.
- Do not expose raw solver logs, proto details, hashes, constraint indices, assumption group names, internal model IDs, or result `meta` in the customer reply.

Name every successfully fetched non-empty business file and describe its purpose. If fetching fails, do not provide a locally reconstructed substitute.

Never report an unqualified utilization percentage. State the denominator in the label or sentence, for example “班次利用率（忙碌分钟/可用班次分钟）” or “排程跨度占用率（忙碌分钟/本次排程跨度）”. Do not compare percentages that use different denominators.

For Scheduling, `resource_summary.busy_minutes` is processing time only; it does not include idle gaps or sequence setup intervals. Derive the end-to-end schedule span from the earliest `start_minute` and latest `end_minute` in `schedule.csv`. Never describe `busy_minutes` as “含换线”. If setup creates a gap, report the two facts separately, for example “加工忙碌 70 分钟；含 5 分钟换线的排程跨度为 75 分钟.” Do not invent a utilization percentage unless its denominator is present in an authoritative artifact or clearly defined source calendar.

Unless asked, do not include shell commands, source code, HTTP methods, JSON, hashes, internal IDs, worker details, protocol terms, or assertions about how the solver was implemented. Internal reasoning and host tool-call traces may remain visible in the product UI; keep the agent's final customer reply concise and non-technical.

In the default customer reply, do not print `OPTIMAL`, `Dryrun`, English schema terms such as `eligible`, `available`, or `qualified`, internal constraint/objective names, numeric objective weights, solver names, solver runtime, bounds, or gap. Translate them into business outcomes such as “已找到最优安排”, “所有班次均已覆盖”, or “所有人员均符合排班条件”.

Describe remote file delivery as a downloadable file or attachment. Claim a local filesystem path only when the file was actually written to a location the user can access.

### Customer reply check

Before sending the completed reply, remove implementation detail unless the user explicitly requested it. Keep the answer short and business-oriented: a result table first, then the few trade-offs or exceptions that affect the decision, then the downloadable files. Internal thought, tool cards, and execution traces may remain in the host UI; they are not a reason to repeat commands or protocol details in the customer text.
