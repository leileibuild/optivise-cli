# ChatGPT with Codex

**Compatibility: setup guidance only.** Enable a local command tool in the Codex environment and confirm its approval policy before using this flow.

Prompt:

```text
Use $optivise-cli. Read only the files I name, choose an immutable v3 model/profile, create an explicit mapping, run `optivise lint`, then `optivise dryrun`. Show me the complete manifest and wait for approval before `optivise run`; report the result envelope and downloaded artifacts.
```

The agent should install the package once, reuse `optivise`, and report the run status and output path after approval.
