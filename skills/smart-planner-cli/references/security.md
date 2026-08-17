# Security guidance

- Show the dry-run manifest before every new validation or solve request.
- Treat the endpoint and model ID as user-visible data.
- Never print, copy, or put bearer tokens into a prompt or manifest.
- Use a project data directory containing only the named CSV files.
- Review expected local writes before approving a solve.
- HTTPS is required except for loopback development URLs.
- The CLI has no daemon, telemetry, background process, or unrelated file discovery.
- The client cannot guarantee hosted-service retention. Link to the Optivise privacy policy for service-side handling.
