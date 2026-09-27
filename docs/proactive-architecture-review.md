# Proactive architecture review and editable deployment designs

Verified on 2026-09-26 using the saved Insights snapshot `b12bc42edcb309385397768ae7d18ec1f1cd7c7553d22da6df3d2095090ed094`, repository revision `1724902e3b971592a013d5d75ebe282b6c08ddc3`, scope `cortex:deploy/cortex/preprod`.

## Behavior

The initial analysis scans the repository once and saves its evidence. When the requested environment identifies one deployment scope, the response already contains a saved architecture proposal. The deployment diagram is the initial view; the application architecture remains a separate view. Scope ambiguity asks for a selection instead of merging different environments. Switching environments selects one scope by default; combining related definitions is an explicit option.

The proposal immediately includes the observed Cortex workloads, container placement, declared replicas, capability providers, ingress, configuration sources and justified edge/vault additions. The complete LLM review starts automatically after the HTTP response, against that same snapshot. It reviews all observations, findings and configuration bindings in bounded batches. It neither clones again nor reads a different checkout.

`/api/architecture/design` returns short requests with saved job status. A browser disconnect does not cancel the review. Atomic JSON records preserve the draft, job and each completed model response. A live worker renews a lease; a later request can resume a stale worker from checkpoints. Local file locks serialize writes across processes that share the same data directory, and expected revisions reject stale editor writes. The deployment must persist `data/architectures` (or `LAUNCHPILOT_ARCHITECTURE_DIR`) across restarts. This is a shared-filesystem implementation; replicas with isolated ephemeral disks do not share these records.

Edits are stored separately from evidence and replayed over the proposal. Completing the background review preserves saved edits. Users can add/edit/remove components and connections, change workload images and pod counts, undo changes, and download the current design. Changing environments loads that environment’s own draft.

## Infrastructure contract

For the selected Cortex deployment, exports take the saved design ID and revision. They implement supported workload additions, image/tag and replica changes, workload removals, URL environment bindings, capability dependencies, and capability additions based on provider contracts already declared in this scope. Capability configuration and instance parameters are editable when adding a capability. Removing the proposed edge or vault also removes its generated Azure additions.

The bundle contains the selected topology, user edit history, configuration changes, original evidence and reviewed Cortex manifests, alongside Terraform and Bicep. Display names/layers do not rename runtime identities. Custom components without a provider implementation, arbitrary migrations, and rewiring managed origin/secret controllers require implementation before IaC export; the UI identifies these requirements before download. Architecture-only relationships and external dependencies are explicitly recorded. Edited IaC compilation currently supports Cortex; other deployment owners retain their existing unedited generator and need an edit compiler before edited infrastructure export.

Existing platform operators still own the database/cache resources. Provider-generated pod counts, database HA schema, cluster inputs and secret values remain explicit platform validation inputs. No cloud deployment or live-resource verification was performed.

## Failure reproduced and fixed

The browser showed `Failed to fetch` on the old separate recommendation request. A retry against the saved preprod snapshot also reproduced a model-validation failure. Its first topology response cited existing graph connection IDs in citation lists. Those connections had valid recorded source references, but the validator required leaf evidence IDs and rejected them. A complete regeneration then returned inconsistent repository-only dispositions.

Known graph resource/connection/binding/finding references now resolve to their exact recorded citations; invented IDs remain invalid. Repository-only validation is retained, with conflicting components/resources identified in the error. The original cached topology then passed validation without regeneration. The resumed GPT-5.5 review completed **134 resource decisions, 754 bindings and 341 findings in 11 logical passes**, producing plan `87d4f2778ddcaf07aee2f5ea3a3633157c2429cfdb5a675c21d7f93ed53008fd`.

## Verification

- Full suite: 452 tests passed, including checkpoint recovery, stale leases, revision conflicts, undo, dangling endpoints, proactive initial analysis and edited manifest exports.
- Production dashboard build and TypeScript checks passed.
- Real browser: changed BFF replicas from 2 to 3, added a one-pod workload, added and rewired a runtime URL connection, removed the workload, and undid all temporary changes.
- Downloaded revision 4: 11 workloads, 26 application pods, BFF replicas 3, URL bound to the added service. Downloaded revision 5: the same variable pointed to the selected backend and port 8002.
- All temporary edits were undone; saved revision 11 has no edits and shows the repository baseline of 10 workloads / 24 application pod replicas.
