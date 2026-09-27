# Repository evidence → complete target design → infrastructure

LaunchPilot now separates three things that used to be mixed together: what the repository declares, what its code reads or references, and what a recommended deployment should add or change.

The dashboard's repository review contains an interactive architecture graph. Select deployment roots for one environment, inspect a resource or connection, and review its file/line references and configuration path. The target-design view uses the same snapshot and marks recommended additions separately. A model response cannot invent source citations or quietly omit a resource: every observation needs an explicit disposition, every configuration binding needs a delivery path, and every unresolved finding needs a concrete recommendation.

The diagram uses aligned vertical layers across a wide canvas, distinct component icons and orthogonal connectors that avoid component cards. Flow controls isolate traffic, secrets, identity or platform connections. Workload resources are combined by default: an explicitly connected Kubernetes Deployment, its dedicated Service/Ingress and unshared ServiceAccount become one application card. External connections are redirected to that card; all original resources, internal connections, bindings and source references remain in its inspector. Shared resources and resources from different deployment scopes stay distinct. The grouping changes presentation only; it does not change the evidence or exported infrastructure. The saved review URL retains the selected deployment scope.

## Repository analysis

`packages/core/src/architecture/scanner.ts` recursively inventories Terraform/HCL and Terraform JSON, Bicep, ARM JSON, Compose, Kubernetes YAML, Helm templates/values, CI/CD workflows, Dockerfiles, application configuration and source files. It includes hidden deployment directories such as `.github`.

The evidence includes:

- Resource declarations, module references and dependency expressions, scoped by deployment root and Kubernetes namespace.
- Compose service dependencies, connection-URL host references, environment inputs, mounts, secrets and build contexts.
- Kubernetes environment/secret/config-map references, service accounts, PVCs, CSI SecretProviderClass/Key Vault links, ExternalSecrets, ingress backends and Service pod selectors.
- JavaScript/TypeScript environment reads, destructuring and local aliases passed to imported resource clients, extracted with the TypeScript syntax tree. Comments and example strings do not count as reads.
- Literal configuration-access patterns in other languages, plus `.env.example`, application configuration and connection-string accessors. Dynamic/inter-file flows remain findings for the recommendation stage; they are not fabricated edges.
- File hashes, source line ranges, exclusions, scan limits and a snapshot identifier. Live cloud-account resources, deployed values and runtime connectivity are not inferred from repository declarations.

An SDK import is represented as a client-library observation, not a provisioned database/cache/queue. An app type no longer invents a PostgreSQL requirement, and SQLite is not silently converted into a managed PostgreSQL service.

`.env`, credential files, Terraform state/value files and symbolic links are excluded. Deployment context is redacted before it reaches the model or browser. Secret names and delivery references remain visible, but literal credential values and Kubernetes Secret data do not.

Static analysis does not evaluate Terraform variables/modules, render Helm, run migrations, execute repository code, or resolve arbitrary data flow. Those boundaries are recorded and drive explicit recommendations. A scan that hits its size limit cannot produce a plan represented as covering the whole repository. Large repositories require an appropriate deployment scope; the model packet is never silently truncated.

## Recommendations

The configured Catalyst/Compass provider receives the selected evidence packet and redacted deployment definitions. The Azure recommendation includes workload hosting, resource disposition, protocol compatibility, configuration/secret delivery, networking, identity/RBAC, image delivery, observability, availability, backup and sizing decisions. Missing design information receives a concrete recommendation and rationale. Real subscription IDs, regions, image digests, credentials and capacity settings remain named deployment inputs.

The model uses short evidence aliases; LaunchPilot resolves these back to the original immutable IDs and validates the entire response. Connections claimed as repository facts must match an observed directed connection. Recommended connections are labeled as recommendations. Every resource, configuration binding and finding in scope must be covered before the plan is shown as a target design.

Current target generation supports **Azure**, producing both Terraform and Bicep. Existing AWS/GCP declarations are analyzed as evidence; this does not yet provide native AWS/GCP target generation. The older three-tier cost simulator remains separate and is labeled accordingly. Generic live-deploy scaffolding is disabled in the dashboard and guarded when a repository architecture is present.

Azure service guidance is part of the generation constraints, not repository evidence. In particular, new Redis provisioning uses [Azure Managed Redis](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq), and Container Apps/Key Vault bootstrap uses an explicitly planned [user-assigned identity and scoped permissions](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets). PostgreSQL application roles require data-plane initialization, not a claim that an ARM administrator login creates a least-privilege application user.

## Infrastructure bundle

The selected plan is saved server-side. The export endpoint accepts only its ID, loads its original repository snapshot, and generates a complete resource implementation. The client cannot submit replacement resource definitions or credentials to the generator.

The download contains:

- `main.tf.json`: Terraform with the Azure AzAPI provider.
- `main.bicep` and `workload.bicep`: subscription/resource-group entry points.
- `architecture.arm.json`: the shared resource graph deployed by both entry points.
- `support/`: any explicitly required SQL initialization or deployment configuration files.
- `deployment-parameters.example.json`: required inputs with null values, not invented defaults.
- `plan.json`, `evidence.json`, `implementation.json`, and deployment instructions.

Generation verifies component coverage, declared parameters, credential handling and actual configuration pointers or supporting-file references. Missing coverage, unknown evidence, placeholder images, secret defaults, undeclared resource additions and executable ARM deployment scripts are rejected. These are structural checks, **not** proof of a successful cloud deployment. Review the files, compile/validate, run the target account's what-if/plan, and perform the documented build/migration steps before deployment. Generated SQL/configuration files are never executed by LaunchPilot.

Both entry points deploy the same ARM graph. Terraform owns the deployment wrapper and dedicated resource group; it does not independently manage each nested ARM resource. Incremental ARM updates do not delete removed resources. The README explicitly documents state protection, lifecycle, parameter preparation and validation boundaries. No cloud resources are created by analysis or export.

## CLI

```sh
launchpilot architecture https://github.com/example/repo --out ./review
```

Inspect `review/evidence.json` for deployment unit IDs. For a complete Azure recommendation and both formats:

```sh
launchpilot architecture https://github.com/example/repo \
  --out ./selected-architecture \
  --unit terraform:infra/production \
  --generate --provider catalyst
```

Use an empty output directory. For source-only repositories no unit flag is required. Gateway configuration is shared with analysis/search; see [CATALYST.md](./CATALYST.md).

## Verification

Tests cover real fixture declarations and source code, Compose hostname wiring, Key Vault → CSI → Secret → workload delivery, ingress selectors, source line numbers, secret redaction, excluded files/symlinks, scope isolation, AST alias handling, invented evidence rejection, omitted resources/configuration rejection, and dual-format bundles. `scripts/check-architecture.ts` runs a live gateway review/generation against a selected local repository; it reports counts and writes review artifacts without deploying them.

The live Compass GPT-5.5 fixture check generated a nine-component Azure design and a 39-resource ARM implementation with Terraform and Bicep entry points. `terraform validate` passed with AzAPI 2.12.0; Bicep 0.47.16 compiled both the entry point and the ARM template after decompilation. Compiler warnings were stylistic and included one unused custom-domain parameter. This is a fixture validation, not evidence of deployed resources or subscription-level service availability. Diagram checks cover aggregation, shared-resource isolation and routes avoiding cards.
