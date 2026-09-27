import { z } from 'zod';

const text = z.string().min(1).max(2000);
export const validationTargetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), name: text,
  environment: z.enum(['development', 'qa', 'preprod']),
  architectureId: z.string().regex(/^[a-f0-9]{64}$/), unitIds: z.array(text),
  subscriptionId: z.string().uuid(), resourceGroupName: z.string().regex(/^[\w.()-]{1,90}$/), location: z.string().regex(/^[a-z0-9]+$/),
  parameters: z.record(z.object({ value: z.unknown().optional(), reference: z.object({ keyVault: z.object({ id: text }).strict(), secretName: text, secretVersion: text.optional() }).strict().optional() }).strict()),
  kubernetes: z.object({ context: text, namespace: text }).strict().optional(),
  secretSyncValues: z.object({ identityClientId: z.string().uuid(), tenantId: z.string().uuid(), vaultUri: z.string().url(), serviceAccountName: text, namespace: text }).strict().optional(),
  allowTestDeployment: z.boolean().default(false),
  testDeploymentMethod: z.enum(['bicep', 'terraform']).default('bicep'),
  healthChecks: z.array(z.object({ name: text, componentIds: z.array(text).min(1), url: z.string().url(), expectedStatus: z.number().int().min(100).max(599).default(200), bodyIncludes: z.string().max(1000).optional() }).strict()).max(50).default([]),
  resourceChecks: z.array(z.object({ name: text, componentIds: z.array(text).min(1), resource: z.string().regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9.-]+$/), namespace: text, condition: text, expected: text.default('True') }).strict()).max(100).default([]),
  platformChecks: z.array(z.object({
    name: text, requirementIds: z.array(text).min(1),
    source: z.union([z.object({ type: z.literal('http'), url: z.string().url() }).strict(), z.object({ type: z.literal('kubernetes'), resource: z.string().regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9.-]+$/), namespace: text }).strict()]),
    assertions: z.array(z.object({ pointer: z.string().startsWith('/'), equals: z.unknown() }).strict()).min(1),
  }).strict()).max(50).default([]),
}).strict();
export type ValidationTarget = z.infer<typeof validationTargetSchema>;
export const validationCheckSchema = z.object({
  id: z.string(), name: z.string(), status: z.enum(['pending', 'running', 'passed', 'failed', 'blocked', 'not-applicable']),
  message: z.string(), startedAt: z.string().optional(), completedAt: z.string().optional(), details: z.array(z.string()).optional(),
}).strict();
export const validationReportSchema = z.object({
  version: z.literal(1), bundleHash: z.string(), architectureId: z.string(), designRevision: z.number().optional(),
  targetId: z.string().nullable(), targetFingerprint: z.string().nullable(), status: z.enum(['running', 'passed', 'failed', 'blocked']),
  startedAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(), checks: z.array(validationCheckSchema),
  cloudValidated: z.boolean(), deploymentAttempted: z.boolean(), deployed: z.boolean(), deploymentTestMethod: z.string().nullable(), providerLockHash: z.string().nullable(), toolVersions: z.record(z.string()),
}).strict();
export type ValidationReport = z.infer<typeof validationReportSchema>;
export const requiredValidationCheckIds = ['integrity', 'terraform-init', 'terraform-validate', 'bicep-build', 'target-inputs', 'azure-account', 'terraform-plan', 'azure-validate', 'azure-what-if', 'kubernetes-dry-run', 'secret-sync-dry-run', 'test-deployment', 'rollout', 'health', 'platform-acceptance'] as const;
export function isValidationComplete(report: ValidationReport): boolean {
  const optional = new Set(['kubernetes-dry-run', 'secret-sync-dry-run', 'platform-acceptance']);
  return report.status === 'passed' && report.cloudValidated && report.deployed && report.deploymentAttempted && !!report.targetId && !!report.targetFingerprint && report.checks.length === requiredValidationCheckIds.length && requiredValidationCheckIds.every(id => report.checks.filter(c => c.id === id && (c.status === 'passed' || optional.has(id) && c.status === 'not-applicable')).length === 1);
}
export interface ArchitectureValidationJob {
  id: string; designId?: string; revision?: number; planId: string; targetId?: string; targetFingerprint?: string; deployTest: boolean;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'blocked'; step: string;
  createdAt: string; updatedAt: string; report?: ValidationReport; error?: string; bundleHash?: string;
}
