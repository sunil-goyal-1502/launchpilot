# Infrastructure validation during script generation

The web **Generate and validate Terraform + Bicep** action and CLI `architecture --generate` always invoke the same fixed validator. They generate from the saved evidence, plan and design revision. They do not rescan the repository to validate it. Reports, job progress and generated bundles are persisted; a browser disconnect does not discard the result.

## Required checks

| Stage | What must pass |
| --- | --- |
| Artifact integrity | Exact generated file hashes; fixed AzAPI wrapper and execution policy |
| Terraform | Provider initialization, `validate -json`, then `plan -detailed-exitcode` with the selected target |
| Bicep | Compilation and lint; warnings retained in the report |
| Target configuration | Snapshot/scope match, required ARM parameters, selected subscription/RG/region and declared cluster namespace |
| Azure | Explicit subscription access, `deployment sub validate --validation-level Provider`, and what-if with a complete change list |
| Kubernetes/Cortex | Strict server-side dry run of all exported manifests against the explicitly selected context |
| Secret controller | Rendered manifests validated server-side; actual deployment outputs replace preliminary identity/vault values before apply |
| Deployment test | Explicitly enabled non-production target, opt-in for this run, a fresh dedicated Azure resource group, and one selected deployment entry point |
| Workloads/configuration | Reconciled controllers, rollout, expected containers/images/replicas/resources/environment bindings and required Secret keys |
| Runtime | Configured health checks and complete coverage of the exposed services and declared Cortex capabilities |
| Platform acceptance | Every requirement in `deployment-readiness.json` mapped to actual platform evidence, checked using explicit JSON-pointer assertions |

Any failed or unavailable required check prevents **Download validated bundle**. The user can download a clearly named **VALIDATION-INCOMPLETE** review bundle with the report, target input example and portable `validate.mjs`. Changing the design invalidates prior export results. Target profiles are fingerprinted; changing a profile requires a new validation run. An interrupted deployment job is never automatically replayed, and simultaneous deployment tests cannot share an Azure resource group or cluster namespace.

## Configure a target

1. Generate a review bundle. Its `validation-target.example.json` comes from the exact selected architecture. Fill the required values from the actual non-production environment and platform contract; nulls are intentional missing inputs.
2. Use Key Vault parameter references for secure parameters. The worker never exports the private target file, cloud credentials, raw outputs, Terraform plan or state.
3. Map `healthChecks[].componentIds` and `resourceChecks[].componentIds` to the component IDs already listed in the example. For each readiness check supply the actual `kind/name`, declared namespace and condition exposed by the platform. Map every `platformChecks[].requirementIds` entry to an actual HTTP JSON acceptance endpoint or namespaced Kubernetes resource, and its JSON-pointer assertions. These cover requirements such as database replicas/recovery, origin protection and source-only configuration; a generic Ready condition does not establish those policies. Do not guess resource names, URLs or acceptance schemas.
4. For the web worker, store completed profiles as a JSON array in a private file, and set `LAUNCHPILOT_VALIDATION_TARGETS_FILE` to its absolute path. The UI exposes the target name, subscription, resource group, region, cluster context and namespace, but never the parameter map.
5. Install Terraform, Bicep, Azure CLI and kubectl on the worker. Override executable paths with `LAUNCHPILOT_TERRAFORM_BIN`, `LAUNCHPILOT_BICEP_BIN`, `LAUNCHPILOT_AZ_BIN` and `LAUNCHPILOT_KUBECTL_BIN`. Registry access is required for provider initialization. Authentication must already be available to the worker; no account defaults are changed.

Read-only planning and validation start with generation when a target is selected. Real deployment additionally requires `allowTestDeployment: true` in the private profile and the displayed target’s deployment checkbox for that run. Production deployment roots are rejected by the test runner. Test resources remain for review and lifecycle management; the validator does not destroy them or change public DNS.

Terraform deployment tests require `LAUNCHPILOT_VALIDATION_STATE_DIR` on private persistent storage. Each run retains its workspace/state, including failed applies. Ordinary local checks use temporary workspaces and remove them afterward. Bicep tests retain Azure deployment history in the explicit target. The report distinguishes a deployment attempt from a completed deployment.

Use a long-lived Node.js worker with persistent architecture storage (`LAUNCHPILOT_ARCHITECTURE_DIR`) for cloud validation. The Next route starts the saved job after returning HTTP 202; short-lived/serverless hosting must provide a worker duration sufficient for deployment/rollout or move the same runner into a durable job worker. Read-only interrupted jobs can resume; deployment jobs require inspection before another test.

## CLI and portable bundles

```sh
launchpilot architecture local:///path/to/repo --out ./review --unit cortex:deploy/qa --generate --validation-target /private/qa-target.json
# Explicit deployment test in a configured target:
launchpilot architecture local:///path/to/repo --out ./tested-review --unit cortex:deploy/qa --generate --validation-target /private/qa-target.json --test-deploy
# Rerun the exact exported revision without rescanning or invoking a model:
node validate.mjs --config /private/qa-target.json
node validate.mjs --config /private/qa-target.json --deploy-test
```

Exit codes are 0 for all required checks passed, 2 for incomplete prerequisites and 1 for a failed check. The ZIP includes `validation-report.json`, `validation-spec.json`, the checked provider lock and the fixed validator. The report records artifact hash, target fingerprint, tool versions, timestamps and individual diagnostics.

## Meaning of a pass

Static checks do not establish cloud deployability. Azure validate/what-if and Terraform plan do not prove that images start or databases are usable. This is why deployment, runtime and platform acceptance gates remain incomplete until actually exercised. The report identifies which entry point (`bicep` or `terraform`) was applied; it does not claim both were separately deployed. Resource conditions, health endpoints and acceptance assertions must implement the real platform/application contract. The validator checks that evidence; it does not implement an unknown provider’s backup/restore process or infer a successful audit from a resource being Ready. Revalidate before rollout when inputs, policies, quotas, image availability or dependencies change.
