# ChatGPT with Codex

**Compatibility: setup guidance only.** Enable a local command tool in the Codex environment and confirm its approval policy before using this flow.

Prompt:

```text
Use $smart-planner-cli. Inspect this project's CSV files, run smart-planner solve --dry-run --format json, show me the full manifest, and wait for my approval before submitting anything.
```

The agent should install the package once, reuse `smart-planner`, and report the run status and output path after approval.
