// LaunchPilot Core — Programmatic API
// Note: extensionless imports for Turbopack/bundler compatibility

// Types (all)
export * from './types/index';

// Orchestrator
export { PipelineContext } from './orchestrator/context';
export { DeploymentPipeline } from './orchestrator/pipeline';
export type { PipelineOptions, PipelineResult } from './orchestrator/pipeline';

// Agents
export { IngestionAgent } from './agents/ingestion/ingestion-agent';
export { InfraPlannerAgent } from './agents/infra-planner/infra-planner-agent';
export { CostEstimatorAgent } from './agents/cost-estimator/cost-estimator-agent';
export { SecurityAgent } from './agents/security/security-agent';
export { DeployAgent } from './agents/deploy/deploy-agent';
export type { DeployInput } from './agents/deploy/deploy-agent';
export { AIAnalyzerAgent } from './agents/ai-analyzer/ai-analyzer-agent';
export { SemanticSearch } from './agents/ai-analyzer/semantic-search';

// Cloud providers
export { createCloudProvider } from './cloud/cloud-provider';
export type { ICloudProvider } from './cloud/cloud-provider';

// Infra planner sub-modules
export { buildStrategies } from './agents/infra-planner/strategy-builder';
export { mapRequirements } from './agents/infra-planner/resource-mapper';
export { generateMigrationOptions, shouldProvisionResource } from './agents/infra-planner/baas-migration';

// Cost estimator
export { calculateCost } from './agents/cost-estimator/calculator';

// Terraform / Deploy sub-modules
export { checkTerraformInstalled, validateAWSCredentials, getTerraformPath } from './agents/deploy/terraform/credential-validator';
export { TerraformExecutor } from './agents/deploy/terraform/executor';
export { generateTerraformHCL } from './agents/deploy/terraform/hcl-generator';
export { getCheckpointForResource, mapTerraformOutputsToDeployResult } from './agents/deploy/terraform/resource-map';

// LLM provider
export { createLLMProvider } from './agents/ai-analyzer/llm-provider';
export { resolveProviderConfig } from './agents/ai-analyzer/provider-config';
export { CatalystClient } from './agents/ai-analyzer/catalyst-client';
export { scanRepositoryArchitecture } from './architecture/scanner';
export { selectCortexPlatformTarget } from './architecture/deployment-target';
export { prepareCortexPlatform } from './architecture/cortex-platform';
export { buildNativeCortexBundle, collectCortexTerraform } from './architecture/cortex-native';
export { resolveCortexDefinitions } from './architecture/cortex-definitions';
export { recommendArchitecture, selectArchitectureScope, validateArchitecturePlan } from './architecture/planner';
export type { GroundedArchitecturePlan } from './architecture/planner';
export { generateArchitectureArtifact, buildArchitectureBundle, zipArchitectureBundle } from './architecture/iac';
export type { ArchitectureArtifact } from './architecture/iac';
export { buildDeploymentTopology } from './architecture/deployment-topology';
export { buildCortexDeploymentBundle } from './architecture/cortex-bundle';
export type { DeploymentTopology, DeploymentNode, DeploymentWorkload, DeploymentContainer } from './architecture/deployment-topology';
export { chooseDeploymentScope, materializeArchitectureDesign, inspectArchitectureDesign, designEditSchema } from './architecture/design';
export type { ArchitectureDesign, ArchitectureReviewJob, DesignEdit, DesignIssue } from './architecture/design';
export { prepareValidationBundle, validateGeneratedBundle } from './architecture/validation';
export { validationTargetSchema, validationReportSchema, isValidationComplete, requiredValidationCheckIds } from './architecture/validation-types';
export type { ValidationTarget, ValidationReport, ArchitectureValidationJob } from './architecture/validation-types';
export type { LLMProvider, ProviderConfig, ProviderType } from './agents/ai-analyzer/llm-provider';

// Utils
export { extractRepoName, validateRepoUrl } from './utils/validator';
export { cleanupDir } from './utils/fs-helpers';
export { logger } from './utils/logger';
export { getCDNLabel, getLBLabel, getComputeLabel, getDBLabel, getCacheLabel, getQueueLabel, getStreamLabel } from './utils/cloud-labels';

export * from './architecture/experience';
export * from './architecture/cost';
export * from './architecture/architect-review';
