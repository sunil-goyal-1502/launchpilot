# Catalyst and Compass integration

## Model selected for this checkout

On 2026-09-26 the existing Athar credential successfully served **`gpt-5.5`**.
Live tests passed text generation, structured JSON and code chunk summaries
through LaunchPilot's new client. The local ignored configuration selects that
model for all three operations, using low reasoning effort.

Verification completed:

- 416 automated tests across 39 files passed, including gateway contracts,
  credential isolation, error handling, cache invalidation, retrieval and web API behavior.
- Root TypeScript checks and all workspace production builds passed.
- The live CLI analyzed and indexed `tests/fixtures/sample-express-api`, then
  answered a Docker startup question using the retrieved files through GPT-5.5.
- The built Next.js dashboard completed a separate live GPT-5.5 review of that
  fixture and rendered its model, purpose, recommendations and security concerns.
  sql.js is externalized in Next.js so its WASM asset resolves at runtime.
- Catalyst's model routing/header contract is covered by automated tests. The
  live inference checks used explicit Compass mode, matching Athar's current setup;
  they did not provision or change a Catalyst gateway deployment.

Compass's authenticated `/v1/models` list also included `gpt-6-sol` and
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. Inference requests for all
four returned HTTP 400 indicating missing quota or model access with this
credential. `gpt-5.4` also succeeded. A catalogue entry alone does not establish
that the credential can run that model. GPT-5.5 was the newest GPT generation
successfully verified for this credential; model entitlement can change.

Core42's [model catalogue](https://www.core42.ai/compass/documentation/compass-models)
and [changelog](https://www.core42.ai/compass/documentation/compass-changelog)
publicly list GPT-5.6. The additional GPT-6 Sol entry was observed in the live API.
These observations are dated, not a permanent model ranking. To upgrade after
access is enabled, change `CATALYST_AI_MODEL` and run the synthetic check again.

## Through an existing Catalyst deployment

```dotenv
LAUNCHPILOT_AI_PROVIDER=catalyst
CATALYST_AI_GATEWAY_URL=https://your-existing-gateway.example/v1
CATALYST_AI_MODEL=gpt-5.5
CATALYST_AI_GATEWAY_TOKEN=
CATALYST_AI_REASONING_EFFORT=low
```

Use the actual gateway URL and ensure the model route exists on that deployment.
A Compass model being enabled does not automatically create a Catalyst routing
rule. The inspected local Catalyst reference chart lists routes up to GPT-5.4;
this LaunchPilot change does not modify or deploy that chart.

The client posts to `/v1/chat/completions`. It preserves gateway path prefixes,
normalizes a trailing `/v1`, and sends identical model IDs in the JSON `model`
field and `x-model-id` header, including model overrides and summary calls.
`CATALYST_AI_GATEWAY_TOKEN` is optional client-to-gateway authentication. Catalyst
injects the upstream provider credential. An Anthropic key is never substituted
for a gateway token.

## Explicit Compass mode, matching Athar

```dotenv
LAUNCHPILOT_AI_PROVIDER=catalyst
CATALYST_AI_GATEWAY_URL=https://api.core42.ai/v1
CATALYST_AI_MODEL=gpt-5.5
CATALYST_AI_REASONING_EFFORT=low
CATALYST_AI_KEY_FILE=/absolute/path/to/platform/services/ai-gateway/.env
```

This mode uses the Compass bearer directly and omits `x-model-id`. The local
credential reader parses only a literal `AI_GATEWAY_API_KEY` assignment; it does
not execute or source the file. The ignored local configurations reference
Athar's existing credential file without copying the secret.

Alternatively set `CATALYST_AI_GATEWAY_TOKEN`, which takes precedence over the
file reference. In hosted environments supply that variable through the server's
secret configuration. `CATALYST_AI_KEY_FILE` is supported only in exact Compass
mode, so an upstream key is not accidentally sent as gateway authentication.
There is no automatic switch between Catalyst, Compass, Anthropic, and Ollama.

## Configuration reference

| Setting | Purpose |
| --- | --- |
| `LAUNCHPILOT_AI_PROVIDER` | `catalyst`, `anthropic`, or `ollama`; explicit CLI selection wins |
| `CATALYST_AI_GATEWAY_URL` | Required gateway base, or exact Compass HTTPS base |
| `CATALYST_AI_MODEL` | Required chat model for deep analysis and search answers |
| `CATALYST_AI_SUMMARY_MODEL` | Optional chat model for chunk summaries; defaults to the analysis model |
| `CATALYST_AI_GATEWAY_TOKEN` | Optional gateway bearer; required for Compass unless a key file is provided |
| `CATALYST_AI_KEY_FILE` | Local Compass key-file reference |
| `CATALYST_AI_TIMEOUT_MS` | Total per-completion deadline, including retries; default 120000, maximum 600000 |
| `CATALYST_AI_REASONING_EFFORT` | Optional `none`, `low`, `medium`, or `high`; both chosen models must support it |

Without an explicit provider, any configured Catalyst URL or model selects
Catalyst, including incomplete configurations. This prevents partial Catalyst
setup from silently sending code to an unrelated provider. Otherwise the
existing Ollama/Anthropic selection rules remain. CLI flags include
`--provider`, `--model`, and `--summary-model`.

The CLI reads process environment. The README's `node --env-file=.env` commands
load a file explicitly; Next.js loads `packages/web/.env.local`. No `NEXT_PUBLIC_`
credential variables are used, and browser request bodies cannot select a
gateway endpoint or provide its credential.

## Request and response behavior

Requests use `max_completion_tokens`, `stream:false`, and `store:false`; JSON
analysis also requests `response_format: { type: "json_object" }`. Temperature
is omitted for compatibility with reasoning models. The full analysis JSON
schema is included in the prompt and validated locally before indexing.

Network failures, HTTP 429 and HTTP 5xx receive at most three attempts against
the same model and URL, bounded by one deadline. Redirects, permanent HTTP errors,
invalid JSON, refusals, empty answers and token-truncated output fail explicitly.
Provider response bodies and credentials are not included in error messages.
Missing model access receives a specific diagnostic. An AI analysis failure
preserves the deterministic blueprint and exposes `aiError`; it does not select
another model or produce a fabricated AI review.

Token counts come from the response. Gateway model prices are deployment
dependent, so `estimatedCostUSD` is `null` and the CLI displays “cost not
estimated.” It does not label inference as free or apply Claude pricing to GPT.

The summary model is a **chat model**, not a vector embedding model. LaunchPilot
generates its 256-dimensional search vectors locally from summary words. Native
`/v1/embeddings` is outside this integration.
