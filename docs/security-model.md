# Security model

The trust boundary is explicit. The agent and user choose the project directory, model ID, configuration, and command. The CLI does not grant itself authority to discover other files or run operations in the background.

## Path controls

- Dataset names accept a conservative filename character set and are resolved through `realpath`.
- A dataset symlink that escapes the selected data directory is rejected.
- Artifact filenames must be simple CSV basenames. Traversal, separators, and non-CSV names are rejected before any artifact download or write.
- Server dataset names used by `init` are validated before template files are created.

## Network controls

- HTTPS is required for non-local backends.
- URLs cannot include credentials, query strings, or fragments.
- Requests abort after 30 seconds by default.
- Authorization uses a bearer header when a local session exists. Manifests expose only `bearer` or `anonymous`.

## Limits of this model

These controls protect the local CLI boundary. They do not describe backend retention or service-side access controls. Those belong in the service privacy policy and applicable agreement.
