# LaunchPilot

Repository analysis now includes a source-referenced resource/configuration graph, interactive target-design review, and complete Azure recommendations with Terraform + Bicep export. See [the evidence-to-infrastructure workflow](docs/EVIDENCE-ARCHITECTURE.md) for supported formats, validation boundaries and CLI usage.

LaunchPilot inspects a GitHub or local repository, detects its technology stack,
proposes cloud infrastructure, estimates cost, and generates security policies.
The CLI and Next.js dashboard share `@launchpilot/core`. AI code review and code
search can use Catalyst AI Gateway, explicit Compass access, Anthropic, or Ollama.

Deployment is simulated by default. The existing live path generates and applies
AWS Terraform; its ECS task still uses a placeholder `nginx:alpine` image, so it
does not yet build and publish the inspected application.

## Run locally

Use Node.js 22 LTS and npm:

```bash
npm ci
npm run dev -- analyze local:///absolute/path/to/repo
npm run dev -- deploy local:///absolute/path/to/repo --cloud aws --strategy low --non-interactive
npm run dev -- estimate local:///absolute/path/to/repo
npm run dev -- --help
```

The deploy example uses simulation. `--live` provisions billable infrastructure;
it is not needed to analyze or test the AI integration.

## Catalyst / Compass AI

Copy `.env.example` to `.env` and set an actual endpoint and an enabled chat model.
For Catalyst, the client sends the model in the JSON body and `x-model-id`.
For direct Compass, use `https://api.core42.ai/v1` and a Compass credential.

```bash
node --env-file=.env --import tsx scripts/check-ai.ts
node --env-file=.env --import tsx packages/cli/bin/launchpilot.ts analyze local:///absolute/path/to/repo --ai
node --env-file=.env --import tsx packages/cli/bin/launchpilot.ts index local:///absolute/path/to/repo
node --env-file=.env --import tsx packages/cli/bin/launchpilot.ts search local:///absolute/path/to/repo "How does authentication work?"
```

`--provider catalyst`, `--model <route>` and `--summary-model <chat-route>` override
provider/model selection. Model and provider changes invalidate the AI cache.
There is no automatic retry against a different provider or model.

For the dashboard, place the same configuration in `packages/web/.env.local`,
then run `npm run dev --workspace web` and choose **Include AI code review** in
the deployment wizard. Endpoints and credentials are read only by the server.
The UI displays the review and any failure alongside the detected blueprint.

See [Catalyst configuration](docs/CATALYST.md) for authentication, model access,
timeouts, and the live verification results, and [architecture](docs/ARCHITECTURE.md)
for the code map and current product boundaries.

## Verify

```bash
npm test
npm run lint
npm run build
```

Tests cover both the workspace core and the retained legacy AI client, gateway
routing and errors, cache invalidation, indexing/search, and the web analysis API.
`scripts/check-ai.ts` sends three synthetic prompts to the configured provider;
it does not submit repository contents or deploy infrastructure.
