import type {
  ApplicationBlueprint,
  ScalingStrategy,
  SecurityPolicy,
  CostBreakdown,
  CloudProvider,
  StrategyTier,
  BaaSMigrationChoice,
  AIAnalysis,
  ArchitectureDesign, ArchitectureReviewJob, ArchitectureCloud, DeploymentTopology, GroundedArchitecturePlan, DesignIssue,
} from '@launchpilot/core';

// --- Request types ---

export interface AnalyzeRequest {
  repoUrl: string;
  ai?: boolean;
  environment?: string;
  cloudProvider?: ArchitectureCloud;
  cortex?: { applicationId: string; environment: string; definitionName?: string };
}
export interface ArchitectureReviewResponse {
  design: ArchitectureDesign; job: ArchitectureReviewJob; plan: GroundedArchitecturePlan | null;
  topology: DeploymentTopology; issues: DesignIssue[];
}

export interface EstimateRequest {
  repoUrl: string;
  provider: CloudProvider;
  migrationChoice?: BaaSMigrationChoice;
}

export interface DeployRequest {
  repoUrl: string;
  provider: CloudProvider;
  strategyTier: StrategyTier;
  migrationChoice?: BaaSMigrationChoice;
  live: boolean;
}

// --- Response types ---

export interface AnalyzeResponse {
  blueprint: ApplicationBlueprint;
  aiAnalysis: AIAnalysis | null;
  aiError?: string;
  architectureReview?: ArchitectureReviewResponse;
  architectureScope?: { unitIds: string[]; reason: string; requiresChoice: boolean };
}

export interface EstimateResponse {
  strategies: ScalingStrategy[];
  security: SecurityPolicy;
  costs: Record<string, CostBreakdown>;
}

export interface DeployResponse {
  id: string;
}

export interface DeploymentStatus {
  id: string;
  repo_url: string;
  repo_name: string;
  provider: string;
  strategy_tier: string;
  status: string;
  live: number;
  blueprint_json: string | null;
  strategy_json: string | null;
  security_json: string | null;
  result_json: string | null;
  cost_total: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// --- API calls ---

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `API error: ${res.status}`);
  }
  return res.json();
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `API error: ${res.status}`);
  }
  return res.json();
}

export async function analyzeRepo(params: AnalyzeRequest): Promise<AnalyzeResponse> {
  return post('/api/analyze', params);
}

export async function estimateCosts(params: EstimateRequest): Promise<EstimateResponse> {
  return post('/api/estimate', params);
}

export async function startDeploy(params: DeployRequest): Promise<DeployResponse> {
  return post('/api/deploy', params);
}

export async function getDeploymentStatus(id: string): Promise<DeploymentStatus> {
  return get(`/api/deploy/${id}`);
}

export async function destroyDeployment(id: string): Promise<{ success: boolean }> {
  return post(`/api/deploy/${id}/destroy`, {});
}

export async function listDeployments(): Promise<DeploymentStatus[]> {
  return get('/api/deployments');
}
