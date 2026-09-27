# Insights architecture diagram investigation

Repository: https://github.com/Cortex-Inception/insight-saas

Revision inspected: `1724902e3b971592a013d5d75ebe282b6c08ddc3`

Date: 2026-09-26

## Reproduction and causes

The user's original snapshot (`27619aa359994a1a94e00964b93c62676b7f3618aed519552bbb5fd49c95f09a`) was a repository-evidence view, with no deployment scope selected. The implementation treated an empty selection as all scopes. Its 71 non-code resource observations produced 67 cards mixing local Compose, CI Compose, `ops`, and Cortex QA, preproduction and production declarations.

The scanner recognized Cortex ApplicationDefinition and CortexApp documents only as generic Kubernetes objects. It missed the workloads, capabilities, connection-secret contracts and instance overlays inside them. Azure Pipelines `${{ }}` expressions under `templates/` were also mistaken for Helm templates. Compose host bind mounts became external storage resources, and a URL with no hostname could produce an empty external-resource card.

The UI drew individual environment bindings as separate connections and stacked all application resources in one column. Fitting the entire graph made the cards unreadable. Combining dedicated Service/Ingress/Deployment declarations alone could not correct these problems.

## Grounded production inventory

The production scope is `deploy/cortex/prod`, pairing:

- `deploy/cortex/prod/insight.yaml`: ApplicationDefinition `insight-v2.0.0`.
- `deploy/cortex/prod/instances/insight-inception.yaml`: CortexApp `insightsaas` in `tenant-inception`, referencing that definition.

The repository's `deploy/cortex/README.md` explicitly describes QA, preproduction and production as separate deployment roots/clusters, even where names are reused. Definition references are therefore resolved within each deployment root.

Production contains 38 declared or referenced observations: 10 container workloads, 13 capabilities, 8 capability connection Secrets, 2 ConfigMaps, 2 additional referenced Secrets, an ingress domain, and the definition/instance metadata pair. The two cache capabilities (`cache` / azure-redis and `redis` / cortex-redis) remain distinct.

Workloads: bff, backend, agentic-core, cortex, frontend, doc-indexer, llm-gateway, digital-simulator, decision-register, translation. The manifest exposes bff and frontend.

Capabilities: main-db, openai, ai-search, blob-storage, speech, service-bus, storage-event-route, doc-intelligence, cache, spicedb, redis, appconfig, translator.

## Corrections

- Empty selection now asks for a deployment scope instead of rendering a repository-wide union.
- Cortex definitions expand deterministic component/capability contracts, explicit service endpoints, secret injection, configuration mounts, queue references and instance overlays. Unresolved references remain visible with evidence and findings.
- CI templates have their own delivery scope. Local filesystem mounts remain workload metadata rather than invented cloud resources.
- Production opens as eight overview groups across five vertical layers, read horizontally. Grouping preserves resource IDs and source references; all 38 resources remain in the inventory.
- Connections aggregate by endpoint and relationship category while retaining the constituent paths and citations. Configuration and source-reference lists are expandable.
- A component trace shows one direct neighborhood. Callers, the selected component, connected workloads and services occupy horizontal columns with at most three cards per column. Flow selection hides unrelated configuration or platform paths.

## Verification and boundaries

Re-scanned all 3,080 repository files at the same commit as the original user analysis. Final corrected evidence ID: `b12bc42edcb309385397768ae7d18ec1f1cd7c7553d22da6df3d2095090ed094`.

Automated regressions cover scope isolation, Cortex expansion and overlays, secret redaction and delivery references, unresolved definitions, CI classification, host mounts, grouped-connection direction, preservation of resource membership and bounded horizontal trace layout. The broad suite passed 431 tests before the last two focused diagram tests were added; the final architecture suite passes 17 tests. The production web build and TypeScript checks pass.

This inventory describes repository declarations and references. It does not claim to enumerate provider-created Azure child resources or verify a running cluster. Built-in capability injection behavior and externally delivered Secrets remain explicit external contracts where this repository does not define them. No cloud deployment was performed for this correction.
