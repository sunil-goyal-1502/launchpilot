# Environment, cloud and budget review

Repository analysis asks for Azure (default), AWS or Google Cloud before ingestion. It saves one evidence snapshot. Environment changes, recommendations, edits and cost calculations reuse that snapshot; the former generic sizing/rescan flow is no longer shown in the architecture wizard.

The environment selector groups deployment definitions into Prod, Preprod, QA and other names actually identified in paths and environment overlays. Staging and UAT remain distinct environments. Repositories without a named environment use Default. Shared Helm charts, Compose files and pipelines remain review evidence rather than additional environment choices. Environment-specific Cortex/manifests take precedence over unrendered Helm overlays for the displayed pod inventory; alternative implementations remain visible in the evidence audit and are not added as duplicate pods.

The recommendation review examines both selected deployment files and related implementations. Related files do not become selected resources. Large related-file reviews are partitioned into bounded requests, including every file part, with exact coverage validation and resumable checkpoints. Configuration binding review retains its separate complete-coverage validation.

The compact guidance shows the three highest-priority architecture decisions. It distinguishes actions needed before deployment, decisions needed before production, and later improvements; other findings are grouped by reliability, security, performance, operations, delivery and cost. Each expandable decision explains the limitation, impact, recommended action, tradeoff, accountable role and observable acceptance check, with affected components and source references. Existing declarations appear in a separate “retain and verify” section rather than being recommended again.

The review checks individual application and init containers, replica counts, placement, migration commands, stateful dependencies, health probes, requests, privilege declarations and image references in the current saved topology. It re-evaluates edits without rescanning or another model call. A probe on one service does not establish health coverage for every service. A Helm template is never proof that a control is enabled or deployed, and backup declarations do not prove successful restoration. Comments and source imports do not count as provisioned controls. Network policies and secret controllers proposed over an existing implementation require reuse/migration evidence; unexplained duplicates fail review validation.

New generated plans use a structured engineering rubric aligned with the selected cloud’s [Azure](https://learn.microsoft.com/en-us/azure/well-architected/pillars), [AWS](https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html) or [Google Cloud](https://cloud.google.com/architecture/framework) Well-Architected principles. Each operational recommendation must include limitation, consequence, priority, owner, tradeoff and verification. Coverage validation requires a response to every identified architecture topic. Existing saved plans remain usable and are explicitly identified as predating the structured rubric; their advice is retained alongside the current topology review.

The review does not invent business availability, recovery or load targets, or claim that proposed protections are already implemented. Owners must supply these inputs and validate actual IAM/network enforcement, quotas, failover, restore, release and alert behavior. Only a complete validation report matching the design and revision can report that the configured target checks passed. This is target-specific evidence, not a certification or blanket production-readiness score. Infrastructure bundles include `architect-review.json` with the generation-time decisions and acceptance criteria; `validation-report.json` remains the source for execution results. Full recommendations, configuration bindings, evidence and validation stages remain available behind expandable sections.

Cloud selection is included in the recommendation prompt, saved design, review job and cache key. Each cloud has separate edits and plans. The proposed edge and secret services use the selected cloud; incompatible existing cloud SDKs and Cortex capability contracts remain explicit dependencies or migrations, not renamed equivalents. **Validated Terraform/Bicep export currently supports Azure. AWS/GCP proposals require native Terraform compilers; Bicep is Azure-only.** The form and export panel state this limitation, and server/core checks prevent cross-cloud Azure exports.

## Cost and capacity

The budget reads the current deployment topology, including saved replica edits. CPU/memory requests are summed within each application pod; sequential init-container requirements use the greater of app totals and the largest init requirement. First-fit packing accounts for indivisible pods. The starting proposal uses 4-vCPU, 16-GiB nodes, a 20% system reserve, 30% request headroom and one spare node. These are explicit proposed inputs, not discovered node-pool facts or workload performance guarantees. Missing request fields use clearly disclosed starting suggestions of 0.25 vCPU / 0.5 GiB. Oversized pods and unknown replica counts are flagged rather than under-sized or priced at zero.

Published Linux on-demand reference prices were checked on 2026-09-27:

| Cloud | Reference region | Instance | USD/hour | Source |
| --- | --- | --- | --- | --- |
| Azure | eastus | Standard_D4s_v5 | 0.192 | [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) |
| AWS | us-west-2 | m5a.xlarge | 0.172 | [EKS pricing, EC2 Oregon example](https://aws.amazon.com/eks/pricing/) |
| Google Cloud | us-central1 | e2-standard-4 | 0.13402284 | [Compute general-purpose pricing](https://cloud.google.com/products/compute/pricing/general-purpose) |

Azure service pricing uses a curated snapshot of 229 official Azure Retail Prices API meters. Supported regional snapshots are `uaenorth` and `eastus`; globally billed services retain the API's `Global` meters, and Front Door keeps separate traffic-zone rates. Match product, region, meter, billing unit and effective date exactly. Do not substitute a different region or apply confidential-compute, batch, spot or commitment discounts without selecting that billing mode. Volume-tier boundaries use the meter's billing unit.

Capability pricing reads only public selectors from the saved deployment definition and instance overrides: location, SKU, replica/partition counts, capacity and model deployments. Credentials and connection values are not copied into pricing metadata. When a single Azure region is declared, the worker scenario proposes co-location there; this does not establish the actual cluster location. Changing the worker region never relocates declared services.

The estimator covers Search (replicas × partitions), Service Bus Premium (messaging units × partitions), App Configuration, block storage and operations, speech, document processing, translation, Event Grid operations, legacy Azure Redis capacity, the explicitly supported OpenAI models, Front Door and Key Vault/private endpoints. Model capacity is a rate-limit allocation, never inferred monthly token usage. Front Door's monthly base fee includes WAF and its private link; the vault's separate private endpoint is charged separately. Standard Redis pricing includes its primary/replica pair.

The UI starts with an editable **reference usage estimate**. Every proposed usage quantity and missing-size suggestion is labelled, and users can switch to unit rates without automatic usage values. Each resource exposes billing meters, rates, tier thresholds, quantities, missing inputs and direct official source links. Partial estimates remain partial when a required meter is absent. A verified owner quote can fill a missing meter or a provider-owned allocation; such quotes are distinguished from catalog rates. Blank inputs are not zero usage.

Cortex PostgreSQL, Cortex Redis and SpiceDB remain provider-owned capabilities: the application contract does not establish their deployed sizes, storage or replicas. The shared platform allocation covers controllers, ingress/load balancers, disks, observability and network infrastructure. Ingress routes do not create additional per-route bills. Application pods are charged through worker capacity once; provider-created pods remain unresolved until the platform supplies their allocation. AWS/GCP worker references remain supported; their native managed-service catalog mappings are not yet implemented. Retained Azure dependencies still use their declared Azure region and rates.

For the saved Insights Preprod snapshot, the default reference scenario is approximately **$2,413.01/month**: 12 of 17 billable resource estimates are priced, the Azure OpenAI resource is partly priced, and 4 provider/platform allocations need inputs. The declared regional `text-embedding-3-large` deployment has no matching UAE North meter in the downloaded catalog; the estimator does not replace it with an East US price. This subtotal excludes these unresolved charges and optional features identified per resource. It is not a complete deployment bill, an incremental-spend quote or a SKU availability guarantee.

Refresh the public snapshots and curate the browser catalog from the repository root:

```sh
node scripts/fetch-architecture-price-catalog.mjs eastus
node scripts/fetch-architecture-price-catalog.mjs uaenorth
node scripts/fetch-architecture-price-catalog.mjs global
node scripts/curate-architecture-price-catalog.mjs
```

Raw downloads stay in the ignored `.cache/architecture-prices/` directory; `packages/core/src/architecture/prices/azure-supported.json` preserves supported meters, IDs, effective dates and retrieval date. The UI flags snapshots over 30 days old. Pricing checks cover exact regions/SKUs, progressive tiers, declared replicas, model deployment modes, changed usage, unsupported meters and double counting. No cloud resource is created to calculate these estimates.

Saved proposals created by the previous derivation version receive a new revision while retaining their edits and review checkpoints. Existing validation results cannot establish readiness for the newer revision. Script generation continues to run the mandatory validation pipeline; no validation checks were removed to simplify the page.
