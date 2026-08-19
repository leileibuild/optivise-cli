# FAQ

## Does it send my data?

Only an explicit approved `run` sends the named CSV datasets and configuration shown by `prepare`. Preparation fetches the public model descriptor needed to determine required datasets, then stops before submission. It does not upload files or write result artifacts.

## Does it run in the background?

No. It is a foreground command. There is no daemon, scheduler, monitoring loop outside the command you start, or hidden process.

## Does it collect telemetry?

The client does not send telemetry or optional command metadata. Review the open source request code and the network behavior document.

## Does the CLI guarantee zero backend retention?

No. The client can describe what it sends, but it cannot promise service-side retention or deletion. See the [Optivise privacy policy](https://www.optivise.cc/privacy).

## Can an agent submit without me?

The skill workflow requires dryrun, showing the manifest, and explicit user approval before `run`. Whether an agent can invoke a local command runner depends on the platform and its permissions.

## Is the hosted solver free?

The CLI is free and MIT-licensed. Hosted solving is metered according to the service plan.
