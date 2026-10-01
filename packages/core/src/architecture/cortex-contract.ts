/** Pure contract detection, shared by the browser editor and server scanners. */
type ObjectValue = Record<string, any>;
export const isCortexPlatformDefinition = (data: ObjectValue) => typeof data?.apiVersion === 'string'
  && data.apiVersion.startsWith('cortex.cortex.ai/') && data.kind === 'ApplicationDefinition'
  && typeof data.spec?.applicationId === 'string' && !Array.isArray(data.spec?.components) && !Array.isArray(data.spec?.capabilities);

// Current Cortex reuses the GVK; its capabilities object contains app roles and
// cookie policy, not the legacy provisioning-contract array.
export const isCortexDefinition = (data: ObjectValue) => typeof data?.apiVersion === 'string'
  && data.apiVersion.startsWith('cortex.cortex.ai/') && !isCortexPlatformDefinition(data)
  && ['ApplicationDefinition', 'CortexApp'].includes(data.kind);
