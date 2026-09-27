# Application and deployment architecture review

Repository: `Cortex-Inception/insight-saas`, revision `1724902e3b971592a013d5d75ebe282b6c08ddc3`.

Evidence snapshot: `b12bc42edcb309385397768ae7d18ec1f1cd7c7553d22da6df3d2095090ed094`.

Selected scope: `cortex:deploy/cortex/prod`.

## Two views

The application view presents logical workload, data, messaging, identity and configuration dependencies with the existing overview, component tracing and source inventory. The deployment view reads pod templates from the immutable deployment snapshot. Its horizontal layers show edge protection, ingress, application pod placement, persistence, AI/messaging and secrets/platform ownership. Group connectors retain every underlying path, and the inspector exposes exact sources, images, resource requests/limits and init containers.

This separation is more than a label change. Code observations and repository scripts do not become pods. Services sharing a Kubernetes pod template stay inside that pod. Separate Cortex components retain independent pod templates and replica counts.

## Production findings

`deploy/cortex/prod/insight.yaml` declares ten components. Nine have two replicas; `doc-indexer` has six. The application baseline is **24 pod replicas**, with one application container per pod. Backend, digital-simulator and decision-register each declare a migration init container inside their own pod template. Init containers do not add pods.

`deploy/cortex/prod/instances/insight-inception.yaml` sets namespace `tenant-inception`, domain `insight.inceptionai.ai`, image-tag overrides and capability sizing. The exported instance and definition are structurally identical to the scanned JSON representation; the exporter does not have a model rewrite them.

AI Search has two replicas and one partition. Blob Storage selects Standard_ZRS. Service Bus selects Premium and declares two queues. `cache` (`azure-redis`) and `redis` (`cortex-redis`) are separate capability IDs and remain separate. The `cortex-postgresql` implementation stays under Cortex ownership; the exporter does not substitute Azure Flexible Server.

The application files do not specify database instance count, node pools, ingress network rules or all external capability implementations. Those are explicit platform requirements. The recommendation proposes one database primary and two standbys, but does not fabricate a provider field that would configure them. Application replica totals exclude database/operator pods and deployment surge.

## Export failure and corrected ownership

The old model classified “Repository-only scripts and quality templates” as a workload even while all its resource decisions said development-only. The ARM validator consequently demanded a cloud resource for scripts. The schema now supports repository-only components, and their dispositions must support that classification. Legacy plans are recognized from their explicit development-only decisions.

Cortex scopes use a deterministic export path. It includes:

- The exact Cortex ApplicationDefinition and CortexApp.
- The same `deployment-topology.json` shown by the UI.
- Terraform and Bicep entry points for a shared ARM template containing proposed Front Door Premium/WAF and private Key Vault additions, including private endpoint/DNS association, federated identity and vault RBAC.
- Proposed External Secrets Operator SecretStore/ExternalSecret mappings for the declared application Secret keys. A fixed offline renderer accepts non-secret Azure outputs; secret values are never exported. The existing Secret object is preserved with a Merge policy.
- Ownership records for all 134 reviewed observations and review records for all 754 configuration bindings, including code-only requirements and external provider contracts.
- Explicit deployment-readiness checks rather than claiming coverage means every platform dependency is already configured.

Existing Cortex/Crossplane providers implement their capabilities. The bundle does not create a second cluster, a second database or an unrelated cache. Other selected additions that this exporter cannot implement fail explicitly instead of being silently omitted.

## Validation and limits

Focused regression tests cover scope isolation, exact container/pod counts, co-located Kubernetes containers, init containers, unspecified replicas, separate cache providers, manifest preservation, private vault/identity resources and full binding review coverage. The actual saved Insights plan successfully exported through the browser, replacing the previous UI error. Its bundle contains 14 Azure resource declarations and both original Cortex manifests.

Bicep compilation and Terraform validation check the generated entry points locally. They do not replace Azure account/API validation or Kubernetes server-side validation. The bundle is marked `platform-validation-required` and has not been applied.

Before rollout, the platform owner must verify cluster/provider versions, node capacity and database HA/backup settings; establish the proposed External Secrets controller and identity/private network path; resolve code-only configuration requirements; and restrict the ingress origin by Front Door backend addresses and the generated Front Door ID before DNS cutover. These external dependencies cannot be proven from the application repository alone.
