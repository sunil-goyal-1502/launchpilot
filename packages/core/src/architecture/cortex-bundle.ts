import type { RepositoryArchitecture } from '../types/architecture';
import type { GroundedArchitecturePlan } from './planner';
import { isRepositoryOnlyComponent, selectArchitectureScope, validateArchitecturePlan } from './planner';
import { buildDeploymentTopology, deploymentDocuments } from './deployment-topology';
import { assessArchitecture } from './architect-review';
import { inspectArchitectureDesign, materializeArchitectureDesign, type ArchitectureDesign } from './design';
import { compileCortexDesign } from './cortex-design';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const parameter = (name: string) => `[parameters('${name}')]`;
const resourceId = (type: string, ...names: string[]) => `[resourceId('${type}', ${names.map(n => `parameters('${n}')`).join(', ')})]`;
const compositeName = (...names: string[]) => `[format('${names.map((_, i) => `{${i}}`).join('/')}', ${names.map(n => `parameters('${n}')`).join(', ')})]`;

/** The Cortex CRs are the implementation of its workloads/capabilities, not ARM resources to duplicate. */
export function buildCortexDeploymentBundle(graph: RepositoryArchitecture, plan: GroundedArchitecturePlan, design?: ArchitectureDesign): Record<string, string> {
  if (plan.provider !== 'azure' || (design?.cloudProvider ?? 'azure') !== 'azure') throw new Error('This infrastructure compiler supports Azure only; use a native Terraform compiler for the selected cloud.');
  if (graph.id !== plan.architectureId) throw new Error('Plan does not belong to the repository snapshot');
  const scope = selectArchitectureScope(graph, plan.unitIds);
  validateArchitecturePlan(plan, scope);
  if (!scope.deploymentUnits.length || scope.deploymentUnits.some(u => u.format !== 'cortex')) throw new Error('Cortex export requires an exclusively Cortex deployment scope');
  const blockers = design ? inspectArchitectureDesign(graph, design, plan).filter(i => i.severity === 'blocker') : [];
  if (blockers.length) throw new Error(blockers.map(i => i.message).join('\n'));
  const topology = design ? materializeArchitectureDesign(graph, design, plan) : buildDeploymentTopology(graph, plan.unitIds, plan);
  const unsupportedAdditions = topology.nodes.filter(n => n.basis === 'recommendation' && !['target-edge-waf', 'target-vault'].includes(n.id) && !/external/i.test(n.owner));
  if (unsupportedAdditions.length) throw new Error(`The selected Cortex design has additional resources that need an implementation: ${unsupportedAdditions.map(n => n.name).join(', ')}. No partial deployment bundle was produced.`);
  const compiled = design ? compileCortexDesign(graph, design, topology) : undefined;
  const documents = compiled?.documents ?? deploymentDocuments(graph, plan.unitIds).filter(d => ['ApplicationDefinition', 'CortexApp'].includes(d.value.kind));
  const instances = documents.filter(d => d.value.kind === 'CortexApp');
  if (instances.length !== 1 || topology.namespaces.length !== 1 || !topology.workloads.length) throw new Error('Select one resolved Cortex application instance for a deployment bundle');
  if (documents.some(d => /\[REDACTED/.test(JSON.stringify(d.value)))) throw new Error('A selected Cortex manifest contains redacted literal values. Convert them to explicit Secret references before exporting deployment manifests.');
  const instance = instances[0].value, namespace = topology.namespaces[0], app = instance.metadata.name;
  const files: Record<string, string> = {};
  const manifestFiles = documents.map((d, i) => {
    const path = `support/cortex/${i}-${d.value.kind.toLowerCase()}.json`;
    files[path] = json(d.value);
    return { source: d.file, file: path, kind: d.value.kind, name: d.value.metadata.name };
  });
  const parameters: Record<string, any> = {};
  const resources: Record<string, any>[] = [];
  const outputs: Record<string, any> = {};
  const addParameter = (name: string, description: string, type = 'string', defaultValue?: unknown) => { parameters[name] = { type, metadata: { description }, ...(defaultValue !== undefined ? { defaultValue } : {}) }; };
  const add = (type: string, apiVersion: string, name: string, properties: unknown, extra: Record<string, any> = {}) => resources.push({ type, apiVersion, name, properties, ...extra });
  const hasEdge = topology.nodes.some(n => n.id === 'target-edge-waf');
  const hasVault = topology.nodes.some(n => n.id === 'target-vault');
  if (hasEdge) {
    for (const [name, description] of Object.entries({ frontDoorProfileName: 'New Front Door Premium profile name', edgeEndpointName: 'Globally unique Front Door endpoint name', wafPolicyName: 'New WAF policy name', originHostName: 'Existing cluster ingress origin hostname; must stay independent of the public domain DNS cutover', originHostHeader: 'Host header accepted by the existing tenant ingress and its TLS certificate', originHealthPath: 'Unauthenticated healthy path on the selected ingress origin' })) addParameter(name, description);
    addParameter('publicDomain', 'Repository-declared application domain; cut DNS over only after origin restrictions and certificate validation', 'string', instance.spec.domain);
    addParameter('originGroupName', 'Origin group within the new profile', 'string', 'application');
    addParameter('originName', 'Origin within the group', 'string', 'cortex-ingress');
    addParameter('routeName', 'Route within the new endpoint', 'string', 'application');
    addParameter('customDomainName', 'Front Door custom-domain resource name', 'string', 'application');
    addParameter('securityPolicyName', 'Front Door WAF association name', 'string', 'application-waf');
    const profile = resourceId('Microsoft.Cdn/profiles', 'frontDoorProfileName');
    const endpoint = resourceId('Microsoft.Cdn/profiles/afdEndpoints', 'frontDoorProfileName', 'edgeEndpointName');
    const group = resourceId('Microsoft.Cdn/profiles/originGroups', 'frontDoorProfileName', 'originGroupName');
    const origin = resourceId('Microsoft.Cdn/profiles/originGroups/origins', 'frontDoorProfileName', 'originGroupName', 'originName');
    const domain = resourceId('Microsoft.Cdn/profiles/customDomains', 'frontDoorProfileName', 'customDomainName');
    const waf = resourceId('Microsoft.Network/frontDoorWebApplicationFirewallPolicies', 'wafPolicyName');
    add('Microsoft.Cdn/profiles', '2025-04-15', parameter('frontDoorProfileName'), { originResponseTimeoutSeconds: 120 }, { location: 'global', sku: { name: 'Premium_AzureFrontDoor' } });
    add('Microsoft.Cdn/profiles/afdEndpoints', '2025-04-15', compositeName('frontDoorProfileName', 'edgeEndpointName'), { enabledState: 'Enabled' }, { location: 'global', dependsOn: [profile] });
    add('Microsoft.Cdn/profiles/originGroups', '2025-04-15', compositeName('frontDoorProfileName', 'originGroupName'), { healthProbeSettings: { probePath: parameter('originHealthPath'), probeRequestType: 'GET', probeProtocol: 'Https', probeIntervalInSeconds: 30 }, loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3, additionalLatencyInMilliseconds: 50 } }, { dependsOn: [profile] });
    add('Microsoft.Cdn/profiles/originGroups/origins', '2025-04-15', compositeName('frontDoorProfileName', 'originGroupName', 'originName'), { hostName: parameter('originHostName'), originHostHeader: parameter('originHostHeader'), httpPort: 80, httpsPort: 443, priority: 1, weight: 1000, enabledState: 'Enabled', enforceCertificateNameCheck: true }, { dependsOn: [group] });
    add('Microsoft.Cdn/profiles/customDomains', '2025-04-15', compositeName('frontDoorProfileName', 'customDomainName'), { hostName: parameter('publicDomain'), tlsSettings: { certificateType: 'ManagedCertificate', minimumTlsVersion: 'TLS12' } }, { dependsOn: [profile] });
    add('Microsoft.Cdn/profiles/afdEndpoints/routes', '2025-04-15', compositeName('frontDoorProfileName', 'edgeEndpointName', 'routeName'), { originGroup: { id: group }, customDomains: [{ id: domain }], patternsToMatch: ['/*'], supportedProtocols: ['Http', 'Https'], forwardingProtocol: 'HttpsOnly', httpsRedirect: 'Enabled', linkToDefaultDomain: 'Disabled', enabledState: 'Enabled' }, { dependsOn: [endpoint, origin, domain] });
    add('Microsoft.Network/frontDoorWebApplicationFirewallPolicies', '2025-03-01', parameter('wafPolicyName'), { policySettings: { enabledState: 'Enabled', mode: 'Prevention' }, managedRules: { managedRuleSets: [{ ruleSetType: 'Microsoft_DefaultRuleSet', ruleSetVersion: '2.1', ruleSetAction: 'Block' }, { ruleSetType: 'Microsoft_BotManagerRuleSet', ruleSetVersion: '1.1' }] } }, { location: 'global', sku: { name: 'Premium_AzureFrontDoor' } });
    add('Microsoft.Cdn/profiles/securityPolicies', '2025-04-15', compositeName('frontDoorProfileName', 'securityPolicyName'), { parameters: { type: 'WebApplicationFirewall', wafPolicy: { id: waf }, associations: [{ domains: [{ id: domain }, { id: endpoint }], patternsToMatch: ['/*'] }] } }, { dependsOn: [waf, domain, endpoint] });
    outputs.frontDoorHostName = { type: 'string', value: `[reference(${endpoint.slice(1, -1)}, '2025-04-15').hostName]` };
    outputs.frontDoorId = { type: 'string', value: `[reference(${profile.slice(1, -1)}, '2025-04-15').frontDoorId]` };
    outputs.domainValidation = { type: 'object', value: `[reference(${domain.slice(1, -1)}, '2025-04-15').validationProperties]` };
  }
  const secretMappings = scope.bindings.filter(b => b.sourceId && scope.resources.some(r => r.id === b.sourceId && /app-secrets$/.test(r.name))).filter(b => b.sourceKey);
  const appSecretNames = [...new Set(secretMappings.map(b => scope.resources.find(r => r.id === b.sourceId)!.name))];
  if (hasVault) {
    for (const [name, description] of Object.entries({ vaultName: 'Globally unique name for the proposed application vault', identityName: 'Dedicated identity for application secret synchronization', clusterOidcIssuer: 'OIDC issuer URL of the existing Cortex cluster, including its trailing slash', privateEndpointSubnetId: 'Existing private-endpoint subnet resource ID with connectivity from the secret controller', vaultPrivateDnsZoneId: 'Existing privatelink.vaultcore.azure.net private DNS zone linked to the cluster VNet' })) addParameter(name, description);
    addParameter('location', 'Azure region for the proposed vault and identity');
    addParameter('secretSyncServiceAccount', 'Namespaced service account used by External Secrets Operator', 'string', `${app}-vault-reader`);
    addParameter('tenantNamespace', 'Existing Cortex tenant namespace; must match exported CortexApp', 'string', namespace);
    const identity = resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', 'identityName');
    const vault = resourceId('Microsoft.KeyVault/vaults', 'vaultName');
    const privateEndpoint = "[resourceId('Microsoft.Network/privateEndpoints', format('{0}-private', parameters('vaultName')))]";
    add('Microsoft.ManagedIdentity/userAssignedIdentities', '2023-01-31', parameter('identityName'), {}, { location: parameter('location') });
    add('Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials', '2023-01-31', "[format('{0}/secret-sync', parameters('identityName'))]", { issuer: parameter('clusterOidcIssuer'), subject: "[format('system:serviceaccount:{0}:{1}', parameters('tenantNamespace'), parameters('secretSyncServiceAccount'))]", audiences: ['api://AzureADTokenExchange'] }, { dependsOn: [identity] });
    add('Microsoft.KeyVault/vaults', '2023-07-01', parameter('vaultName'), { tenantId: '[subscription().tenantId]', sku: { family: 'A', name: 'standard' }, enableRbacAuthorization: true, enablePurgeProtection: true, enableSoftDelete: true, softDeleteRetentionInDays: 90, publicNetworkAccess: 'Disabled', accessPolicies: [] }, { location: parameter('location') });
    add('Microsoft.Authorization/roleAssignments', '2022-04-01', "[guid(resourceGroup().id, parameters('vaultName'), parameters('identityName'), 'secrets-user')]", { roleDefinitionId: "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')]", principalId: `[reference(${identity.slice(1, -1)}, '2023-01-31').principalId]`, principalType: 'ServicePrincipal' }, { scope: vault, dependsOn: [identity, vault] });
    add('Microsoft.Network/privateEndpoints', '2024-05-01', "[format('{0}-private', parameters('vaultName'))]", { subnet: { id: parameter('privateEndpointSubnetId') }, privateLinkServiceConnections: [{ name: 'vault', properties: { privateLinkServiceId: vault, groupIds: ['vault'] } }] }, { location: parameter('location'), dependsOn: [vault] });
    add('Microsoft.Network/privateEndpoints/privateDnsZoneGroups', '2024-05-01', "[format('{0}-private/default', parameters('vaultName'))]", { privateDnsZoneConfigs: [{ name: 'vault', properties: { privateDnsZoneId: parameter('vaultPrivateDnsZoneId') } }] }, { dependsOn: [privateEndpoint] });
    outputs.vaultUri = { type: 'string', value: `[reference(${vault.slice(1, -1)}, '2023-07-01').vaultUri]` };
    outputs.identityClientId = { type: 'string', value: `[reference(${identity.slice(1, -1)}, '2023-01-31').clientId]` };
    outputs.tenantId = { type: 'string', value: '[subscription().tenantId]' };
    const sync = {
      apiVersion: 'v1', kind: 'List', items: [
        { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: `${app}-vault-reader`, namespace, annotations: { 'azure.workload.identity/client-id': '__IDENTITY_CLIENT_ID__', 'azure.workload.identity/tenant-id': '__TENANT_ID__' } } },
        { apiVersion: 'external-secrets.io/v1', kind: 'SecretStore', metadata: { name: `${app}-vault`, namespace }, spec: { provider: { azurekv: { authType: 'WorkloadIdentity', vaultUrl: '__VAULT_URI__', serviceAccountRef: { name: `${app}-vault-reader` } } } } },
        ...appSecretNames.map(name => ({ apiVersion: 'external-secrets.io/v1', kind: 'ExternalSecret', metadata: { name: `${name}-vault-sync`, namespace }, spec: { refreshInterval: '1h', secretStoreRef: { kind: 'SecretStore', name: `${app}-vault` }, target: { name, creationPolicy: 'Merge', deletionPolicy: 'Retain' }, data: [...new Set(secretMappings.filter(b => scope.resources.find(r => r.id === b.sourceId)?.name === name).map(b => b.sourceKey!))].map(key => ({ secretKey: key, remoteRef: { key } })) } })),
      ],
    };
    files['support/secret-sync.template.json'] = json(sync);
    files['support/secret-sync-values.example.json'] = json({ identityClientId: null, tenantId: null, vaultUri: null, serviceAccountName: `${app}-vault-reader`, namespace });
    files['render-secret-sync.py'] = `#!/usr/bin/env python3\n"""Render reviewed, non-secret Azure outputs into the fixed secret-sync manifest. No deployment or network access."""\nimport json, pathlib, sys\nbase = pathlib.Path(__file__).resolve().parent\nvalues = json.loads(pathlib.Path(sys.argv[1]).read_text())\nrequired = ['identityClientId', 'tenantId', 'vaultUri', 'serviceAccountName', 'namespace']\nif any(not isinstance(values.get(k), str) or not values[k].strip() for k in required):\n    raise SystemExit('Supply every non-secret value from support/secret-sync-values.example.json')\nif not values['vaultUri'].startswith('https://'):\n    raise SystemExit('vaultUri must use HTTPS')\nmanifest = json.loads((base / 'support/secret-sync.template.json').read_text())\nreplacements = {'__IDENTITY_CLIENT_ID__': values['identityClientId'], '__TENANT_ID__': values['tenantId'], '__VAULT_URI__': values['vaultUri']}\ndef render(value):\n    if isinstance(value, dict): return {k: render(v) for k, v in value.items()}\n    if isinstance(value, list): return [render(v) for v in value]\n    return replacements.get(value, value) if isinstance(value, str) else value\nmanifest = render(manifest)\nexpected_namespace = manifest['items'][0]['metadata']['namespace']\nif values['namespace'] != expected_namespace:\n    raise SystemExit('Namespace must match the selected CortexApp; reselect the scope to change it')\nmanifest['items'][0]['metadata']['name'] = values['serviceAccountName']\nmanifest['items'][1]['spec']['provider']['azurekv']['serviceAccountRef']['name'] = values['serviceAccountName']\nprint(json.dumps(manifest, indent=2))\n`;
  }
  const template = { $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#', contentVersion: '1.0.0.0', parameters, resources, outputs };
  // Exact preservation is stronger than asking a model to rewrite an operator contract.
  for (const mapping of manifestFiles) {
    const original = documents.find(d => d.file === mapping.source && d.value.kind === mapping.kind && d.value.metadata.name === mapping.name)!;
    if (JSON.stringify(JSON.parse(files[mapping.file])) !== JSON.stringify(original.value)) throw new Error('Cortex manifest changed during export');
  }
  const ownership = scope.resources.map(r => ({ resourceId: r.id, name: r.name, origin: r.origin, implementation: r.origin === 'code' ? 'source observation; disposition and configuration review retained' : r.origin === 'external' ? 'existing platform dependency' : 'Cortex manifest / operator contract', files: manifestFiles.filter(m => r.evidence.some(id => graph.evidence.some(e => e.id === id && e.file === m.source))).map(m => m.file) }));
  const configCoverage = scope.bindings.map(binding => ({ bindingId: binding.id, name: binding.key, consumerId: binding.consumerId, sourceId: binding.sourceId, sourceKey: binding.sourceKey, evidenceIds: binding.evidence, disposition: scope.resources.find(r => r.id === binding.consumerId)?.origin === 'code' ? 'source-code requirement; review target ownership' : binding.resolved ? 'preserved Cortex configuration contract' : 'platform input or capability contract required', reviews: plan.configuration.filter(c => c.bindingIds.includes(binding.id)) }));
  const readiness = {
    status: 'platform-validation-required', cloudValidated: false, applied: false, repositoryManifestsPreserved: !design?.edits.length,
    ...(design ? { designId: design.id, designRevision: design.revision, userEdits: design.edits.length } : {}),
    applicationWorkloads: topology.totals.workloads, declaredApplicationPods: buildDeploymentTopology(graph, plan.unitIds).totals.applicationPods, proposedApplicationPods: topology.totals.applicationPods,
    configurationBindingsReviewed: configCoverage.length, sourceObservationsAreNotSeparateWorkloads: true,
    requiredChecks: [
      ...topology.controls.filter(c => c.decision === 'verify').map(c => ({ name: c.name, action: c.recommendation, evidenceIds: c.evidenceIds })),
      ...(hasEdge ? [{ name: 'Origin protection and DNS cutover', action: 'Before public DNS cutover, restrict the existing origin to AzureFrontDoor.Backend addresses AND the generated X-Azure-FDID value; validate TLS host routing and WebSockets. These changes belong to the existing ingress/network owner.' }] : []),
      ...(hasVault ? [{ name: 'External Secrets controller', action: 'Validate/install the reviewed External Secrets Operator v1 CRDs and controller in the existing cluster, permit service-account token requests, verify OIDC federation and private DNS/routing. Supply existing application Secret keys into the new vault, review existing secret-controller ownership, then merge only those keys. Secret values are never included in the bundle.' }] : []),
      { name: 'Source-only configuration', action: 'Review configuration-coverage.json for source-code requirements that are not declared env bindings. Do not interpret their evidence coverage as proof of live configuration. Apply needed settings through the declared App Configuration or capability provider and verify runtime health.' },
    ],
  };
  const name = 'launchpilot-' + plan.id.slice(0, 12);
  const tf = { terraform: { required_version: '>= 1.5.0', required_providers: { azapi: { source: 'Azure/azapi', version: '~> 2.0' } } }, provider: { azapi: { subscription_id: '${var.subscription_id}' } }, variable: { subscription_id: { type: 'string' }, resource_group_name: { type: 'string' }, location: { type: 'string' }, deployment_parameters: { type: 'any', sensitive: true } }, resource: { azapi_resource: { group: { type: 'Microsoft.Resources/resourceGroups@2022-09-01', name: '${var.resource_group_name}', parent_id: '/subscriptions/${var.subscription_id}', location: '${var.location}', body: {} }, additions: { type: 'Microsoft.Resources/deployments@2022-09-01', name, parent_id: '${azapi_resource.group.id}', body: { properties: { mode: 'Incremental', template: '${jsondecode(file("${path.module}/architecture.arm.json"))}', parameters: '${var.deployment_parameters}' } }, response_export_values: ['properties.outputs'] } } }, output: { azure_outputs: { value: '${azapi_resource.additions.output.properties.outputs}' } } };
  files['main.tf.json'] = json(tf);
  files['main.bicep'] = `targetScope = 'subscription'\nparam resourceGroupName string\nparam location string\n@secure()\nparam deploymentParameters object\nresource group 'Microsoft.Resources/resourceGroups@2022-09-01' = {\n  name: resourceGroupName\n  location: location\n}\nmodule additions './workload.bicep' = {\n  name: '${name}'\n  scope: group\n  params: { deploymentParameters: deploymentParameters }\n}\noutput azureOutputs object = additions.outputs.azureOutputs\n`;
  files['workload.bicep'] = `targetScope = 'resourceGroup'\n@secure()\nparam deploymentParameters object\nresource additions 'Microsoft.Resources/deployments@2022-09-01' = {\n  name: 'architecture-additions'\n  properties: {\n    mode: 'Incremental'\n    expressionEvaluationOptions: { scope: 'inner' }\n    template: loadJsonContent('./architecture.arm.json')\n    parameters: deploymentParameters\n  }\n}\noutput azureOutputs object = additions.properties.outputs\n`;
  files['architecture.arm.json'] = json(template);
  files['deployment-parameters.example.json'] = json(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, { value: value.defaultValue ?? null }])));
  files['deployment-topology.json'] = json(topology);
  files['architect-review.json'] = json(assessArchitecture(graph,topology,{plan,cloudProvider:plan.provider,environment:design?.environment ?? plan.environment,designId:design?.id,revision:design?.revision}));
  files['repository-resource-ownership.json'] = json(ownership);
  files['configuration-coverage.json'] = json(configCoverage);
  files['deployment-readiness.json'] = json(readiness);
  files['repository-tooling.json'] = json(plan.components.filter(c => isRepositoryOnlyComponent(plan, c.id)).map(c => ({ ...c, deployment: 'repository-only', configuration: plan.configuration.filter(b => b.consumerId === c.id) })));
  files['plan.json'] = json(plan);
  if (design) {
    files['architecture-design.json'] = json(design);
    files['design-changes.json'] = json({ revision: design.revision, edits: design.edits, removedResourceIds: compiled?.removedResourceIds, configurationChanges: compiled?.configurationChanges, issues: inspectArchitectureDesign(graph, design, plan) });
    for (const r of ownership) if (compiled?.removedResourceIds.includes(r.resourceId)) r.implementation = 'Removed from the proposed design by user; original evidence retained';
    for (const c of configCoverage) {
      if (compiled?.removedResourceIds.includes(c.consumerId)) c.disposition = 'Consumer removed from proposed deployment by user';
      else if (compiled?.configurationChanges.some(change => change.consumerId === c.consumerId && change.name === c.name)) c.disposition = 'Changed by user; see design-changes.json for the exported binding';
    }
    files['repository-resource-ownership.json'] = json(ownership);
    files['configuration-coverage.json'] = json(configCoverage);
  }
  files['evidence.json'] = json(graph);
  files['README.md'] = `# Cortex deployment architecture\n\nSnapshot: ${graph.id}\nRevision: ${graph.revision}\nPlan: ${plan.id}\n\nThe deployment-topology.json is the same physical model displayed in the UI. The application manifests contain ${topology.totals.workloads} workloads and ${topology.totals.applicationPods} declared application pod replicas. Init containers remain inside their pod templates. Capability-created pods and cluster controllers are not included in that total.\n\n## Ownership\n\nCortex/Crossplane remains the deployment owner of the declared application and capabilities. support/cortex contains structurally identical, redacted-snapshot-checked ApplicationDefinition and CortexApp JSON. Apply them through the existing Cortex GitOps path after platform validation. They preserve separate cache/redis capabilities, database provider, images, ports, queues, model deployments, configuration, replicas and init containers. The cloud resources produced by these external operators are not recreated by Terraform or Bicep.\n\nTerraform and Bicep both deploy architecture.arm.json: only the proposed edge/WAF and private application vault/identity additions. They use a new dedicated resource group; supply existing origin, subnet, private DNS and OIDC issuer identifiers as parameters. They do not create a new cluster or claim to install Cortex. Do not use both entry points on the same resource group. Terraform manages the ARM deployment wrapper, not each nested Azure resource; removing a template resource does not delete it. Destroying its dedicated resource group deletes its resources.\n\nThe application-level model review in plan.json is retained for provenance. Its non-runtime scripts/evals do not create resources. The physical design preserves actual Cortex capability ownership and distinct capability IDs even where older model prose suggested merging Redis or moving PostgreSQL. These are explicit deployment-model corrections.\n\n## Required stages\n\n1. Review deployment-readiness.json and the exact pod inventory in deployment-topology.json. Resolve cluster/provider contracts, database replica/backup policy, node-pool capacity, image pull authorization and source-only configuration requirements. The recommended three-instance database policy is not encoded into an unknown provider schema.\n2. Supply deployment-parameters.example.json through private input files. Validate Azure APIs, region, quotas and policy in the selected account. Run terraform init / validate / plan, or az bicep build then az deployment sub validate / what-if. This bundle has NOT been applied or validated against an Azure account.\n3. Apply the reviewed Azure additions with the chosen tool. Confirm private endpoint DNS/routing and RBAC propagation. Set up required secrets in the proposed Key Vault using the existing secure operations process; values are not Terraform/Bicep parameters or exported files.\n4. For secret delivery, review the External Secrets Operator prerequisite. Copy support/secret-sync-values.example.json and fill the non-secret Azure output values, namespace and service-account name (which must match ARM inputs). Run python3 render-secret-sync.py your-values.json > secret-sync.json, then perform a Kubernetes server-side dry run. The ExternalSecret uses Merge to preserve existing externally owned application Secret objects and unlisted keys. Verify every listed key exists in Key Vault before rollout.\n5. Apply the Cortex definitions through the documented GitOps owner and verify expected Deployments, Services, migrations, readiness and capability connection Secrets. Compare observed pods against the declared baseline; include separate operator/database pods in runtime verification.\n6. For Front Door, obtain the custom-domain validation token from Azure outputs, complete DNS/TLS validation, enforce origin IP and X-Azure-FDID restrictions in the existing platform, and test the BFF API and WebSockets before cutting over the public domain. No DNS cutover is performed by these scripts.\n7. Verify health, queues, configuration, identity, backup/restore and rollback against the previous Cortex manifest revision.\n\n## Evidence and review coverage\n\nrepository-resource-ownership.json covers every scoped observation; configuration-coverage.json covers all ${scope.bindings.length} bindings, distinguishing preserved manifest contracts from code-only requirements and external provider inputs. Coverage is not a claim that an external controller or code-only setting is already configured. deployment-readiness.json is intentionally platform-validation-required, not deployment-ready.\n\n## Provider references\n\n- https://external-secrets.io/latest/provider/azure-key-vault/\n- https://learn.microsoft.com/azure/templates/microsoft.cdn/2025-04-15/profiles/origingroups/origins\n- https://learn.microsoft.com/azure/templates/microsoft.network/2025-03-01/frontdoorwebapplicationfirewallpolicies\n\nNo cloud resources have been deployed.\n`;
  files['.gitignore'] = '*.tfstate*\n.terraform/\n*.tfvars*\nprivate-*.json\nsecret-sync.json\n';
  if (design?.edits.length) {
    files['README.md'] = files['README.md'].replace('declared application pod replicas', 'proposed application pod replicas').replace('structurally identical, redacted-snapshot-checked', 'redacted-snapshot-checked, user-edited');
    files['README.md'] += `\n## User-edited architecture\n\nDesign ${design.id}, revision ${design.revision}. architecture-design.json preserves the edit history; design-changes.json lists configuration changes and removed observations. Original declarations remain in evidence.json. The exported Cortex manifests implement the selected workload replicas/images, new workloads, removals and supported runtime bindings. Display names and diagram layers do not rename runtime resource identities. Architecture-only relationships and external dependencies are listed for implementation review.\n`;
  }
  files['README.md'] += '\n## Architecture review\n\narchitect-review.json records prioritized limitations, recommendations, tradeoffs, owners, evidence and acceptance checks at generation time. Use validation-report.json for actual check results; proposed mitigations are not assumed implemented.\n';
  return files;
}
