# Architecture

Optivise CLI has four small layers:

1. **Command layer** parses options and prints JSON or human-readable output.
2. **Project layer** resolves `project.yaml`, `config.json`, the data directory, and the result directory.
3. **Security layer** validates names and paths, inspects files, enforces the backend URL policy, and bounds requests.
4. **V3 client and run layer** fetches a model descriptor, builds a multipart request, polls a run, and downloads validated CSV artifacts.

The agent owns intent clarification and data preparation. The CLI owns deterministic file selection, request construction, and visible status. The hosted Optivise service owns model execution.

There is no plugin loader, daemon, scheduler, telemetry client, patch engine, or hidden filesystem crawler. Authentication is a local bearer session obtained through the explicit login flow. Logout also removes the legacy `identity.json` file if one exists on an older installation.
