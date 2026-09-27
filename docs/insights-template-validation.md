# Insights exported-template validation

Checked on 2026-09-26 against actual downloaded preprod exports:

- `launchpilot-architecture-73ebc1af054b-r5.zip`: edited architecture, 11 workloads / 26 application pods.
- `launchpilot-architecture-73ebc1af054b-r11.zip`: restored proposal, 10 workloads / 24 application pods.

Both exports contain the same `architecture.arm.json`, SHA-256 `852f881d14f847be268e7207cbfda55542385483a68b971d212f839e4127dfc6`. Their application differences are in the Cortex manifests.

## Results

| Check | Revision 5 | Revision 11 |
| --- | --- | --- |
| Terraform CLI `validate -json`, with initialized cached AzAPI provider | Passed; 0 errors, 0 warnings | Passed; 0 errors, 0 warnings |
| Bicep CLI `build main.bicep` | Passed; one linter warning | Passed; one linter warning |
| Azure validation / what-if using actual target inputs | Not run | Not run |
| Terraform plan using actual target inputs | Not run | Not run |
| Cortex / External Secrets Kubernetes server-side dry run | Not run | Not run |
| Deployment and runtime acceptance tests | Not run | Not run |

The Bicep warning is `no-deployments-resources` at `workload.bicep(4,20)`: the wrapper declares `Microsoft.Resources/deployments` rather than using a Bicep module. Both entry points embed the same ARM resource graph, so compiling the wrappers does not establish that every nested Azure service property or external dependency is valid in the target account.

These two initial audits predate generation-time validation. The export API and CLI now run the [validation pipeline](infrastructure-validation.md) for each generated revision. The report is included in the bundle; only a report with all required checks passed permits a validated download. Missing target inputs leave an explicitly incomplete review bundle.

The new pipeline was also run against the saved Insights preprod design revision 11, using Terraform 1.13.5 and Bicep 0.47.16. Terraform initialization/validation and Bicep compilation passed. The overall result was blocked because no target subscription, resource group, cluster context or runtime acceptance checks were configured. No cloud deployment was attempted.

## Unresolved deployment inputs

The ARM example file still has 12 required null values: Front Door profile, endpoint and WAF names; origin hostname, host header and health path; vault and identity names; cluster OIDC issuer; private endpoint subnet ID; Key Vault private DNS zone ID; and Azure location. The wrappers also require the selected subscription/resource group inputs.

Existing Cortex/Crossplane and External Secrets controller contracts, namespace access, images, secret availability, private DNS/routing, database HA/backup implementation and origin restrictions have not been validated against a live environment. Repository evidence does not establish these runtime conditions.

The artifact correctly records `status: platform-validation-required`, `cloudValidated: false`, and `applied: false`. There is no demonstrated successful deployment of this generated architecture yet.

## Validation boundaries

- Terraform validate checks configuration syntax and internal consistency, without validating provider APIs: https://developer.hashicorp.com/terraform/cli/commands/validate
- Azure what-if previews target changes and has its own resolution/validation limits: https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if

Local validation copies and compiled Bicep output are under `/private/tmp/launchpilot-validation-rk2s5v1x/`.
