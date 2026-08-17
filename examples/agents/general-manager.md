# Plain-language manager scenario

**Scenario: tested locally with the shared fixture; agent platform setup is guidance only.**

> I have 80 units of capacity and four projects competing for it. Please use the planning files in this folder. First show me exactly which files and settings will be sent, where they will go, and what output will be written. Wait for my approval. After I approve, run the model and tell me which projects received capacity, which did not, and where the full CSV is saved.

The agent should translate this request into the required dry-run, approval, and solve sequence. It should not imply that the CLI can make operational changes outside the result files.
