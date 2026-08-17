# Data flow

```mermaid
flowchart LR
  A[Agent and user] -->|prepare CSV and config| B[Local project]
  B -->|descriptor GET| C[Optivise API]
  C -->|model ID and dataset schema| B
  B -->|dry-run manifest| A
  A -->|explicit approval| D[validate or solve]
  D -->|named CSV + config POST| C
  C -->|status and artifacts| D
  D -->|visible JSON and CSV paths| A
```

The dry-run branch stops before the submission `POST`. It reads files to calculate byte counts and SHA-256 hashes, but does not upload or write artifacts. A real run sends only the selected CSV files and configuration. A solve may write server-named CSV artifacts only after their names pass the local safety checks.
