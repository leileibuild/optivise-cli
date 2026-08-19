# Security guidance

- Keep the full manifest, endpoint, immutable model ID, fingerprints, and solver settings in the audit record.
- For a normal business user, show one concise business summary immediately before solve submission; do not expose those internal fields unless requested.
- Never print, copy, or put bearer tokens into a prompt or manifest.
- Use a project data directory containing only the named CSV files.
- Review expected local writes before approving a solve.
- HTTPS is required except for loopback development URLs.
- If the backend is unavailable, produce no solution or candidate result and do not ask a non-technical user to configure it.
- The CLI has no daemon, telemetry, background process, or unrelated file discovery.
- The client cannot guarantee hosted-service retention. Link to the Optivise privacy policy for service-side handling.
