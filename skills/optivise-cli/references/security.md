# Security guidance

- Send only the files named in the single final business confirmation.
- Keep endpoint, immutable model ID, fingerprints, manifest ID, and solver settings in the internal audit record.
- Never print or copy bearer tokens into a prompt, project, mapping, or manifest.
- A customer result must be tied to a real `run_id`, its terminal status, and fetched result or artifacts.
- If the backend is unavailable, produce no candidate answer and install no local solver substitute.
- The CLI has no daemon, telemetry, background process, or unrelated file discovery.
