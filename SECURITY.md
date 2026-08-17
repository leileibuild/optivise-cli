# Security and privacy boundaries

Optivise CLI is designed to be inspectable before it is allowed to submit a job.

## Observable guarantees

- There is no daemon, background process, scheduled task, or hidden worker.
- There is no telemetry or analytics payload. Requests do not include a CLI-command metadata field.
- The CLI does not scan for unrelated files. `validate` and `solve` use the named `<dataset>.csv` files required by the model descriptor, or the CSV files directly in the selected data directory when no required list is supplied.
- `--dry-run` performs a descriptor `GET` only. It does not upload datasets, issue the run `POST`, or write solver artifacts.
- Dry-run manifests include SHA-256 hashes, byte sizes, paths, configuration, endpoint, expected writes, and redacted authentication mode.
- Dataset symlinks resolving outside the selected data directory are rejected.
- Server-provided artifact names and template dataset names are validated before writes.
- HTTPS is required except for loopback development endpoints. Requests have bounded timeouts.

## Scope boundary

These statements describe the open-source client. They are not a blanket promise about backend retention, access, or processing after an explicit request. Review the [Optivise privacy policy](https://www.optivise.cc/privacy) and your service agreement for hosted-service handling.

## Reporting

Please do not disclose a suspected vulnerability in a public issue. Email the maintainers through the security contact listed in the GitHub repository, including reproduction steps, affected version, and impact. We will acknowledge reports and coordinate a fix or mitigation.
