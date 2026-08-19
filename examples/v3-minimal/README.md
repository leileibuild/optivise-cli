# v3 minimal fixtures

These four folders are small agent fixtures for the immutable v3 families. Replace each `model_id` with the value returned by `optivise describe-models` if a server revision changes, then run `scaffold` to download authoritative templates. The checked-in configs use the lowest solver settings and contain no legacy `weights` or YAML project shape.

The mapping files intentionally contain no inference rules. Add explicit rules for named CSV or JSON inputs before `convert`.
