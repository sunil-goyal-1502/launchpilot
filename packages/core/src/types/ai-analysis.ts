import { ApplicationBlueprint } from './application-blueprint';

// ── Architecture patterns detected by AI analysis ──

export type ArchitecturePattern =
  | 'monolith'
  | 'microservice'
  | 'mvc'
  | 'serverless'
  | 'event-driven'
  | 'layered'
  | 'hexagonal'
  | 'cqrs'
  | 'unknown';

// ── API route detected by deep analysis ──

export interface APIRoute {
  method: string;       // GET, POST, PUT, DELETE, etc.
  path: string;         // /api/users, /health, etc.
  handler: string;      // File or function handling this route
  description?: string; // AI-generated description of what it does
}

// ── Data flow step ──

export interface DataFlowStep {
  from: string;
  to: string;
  description: string;
}

// ── Security concern found by AI ──

export interface SecurityConcern {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;     // e.g. "authentication", "injection", "exposure"
  description: string;
  file?: string;
  recommendation: string;
}

// ── Token usage tracking ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  estimatedCostUSD: number;
}

// ── AI Analysis result (deep code understanding) ──

export interface AIAnalysis {
  appPurpose: string;
  architecturePattern: ArchitecturePattern;
  apiRoutes: APIRoute[];
  dataFlow: DataFlowStep[];
  securityConcerns: SecurityConcern[];
  deploymentRecommendations: string[];
  analyzedFiles: number;
  totalChunks: number;
  tokenUsage: TokenUsage;
  analyzedAt: Date;
}

// ── Enhanced blueprint (composes existing blueprint + AI analysis) ──

export interface EnhancedBlueprint {
  blueprint: ApplicationBlueprint;
  aiAnalysis: AIAnalysis | null;
}

// ── Code chunk (semantic unit of source code) ──

export type ChunkType = 'function' | 'class' | 'route' | 'block' | 'config' | 'module';

export interface CodeChunk {
  id: string;           // SHA-256 based deterministic ID
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  chunkType: ChunkType;
  symbolName: string;   // Function/class/route name, or filename for blocks
  language: string;
}

// ── Chunk embedding (vector representation) ──

export interface ChunkEmbedding {
  chunkId: string;
  embedding: number[];  // 256-dim float vector
  summary: string;      // Haiku-generated 1-2 sentence summary
}

// ── Indexed repo metadata ──

export interface IndexedRepo {
  repoUrl: string;
  commitHash: string;
  indexedAt: Date;
  totalChunks: number;
  totalFiles: number;
}

// ── Semantic search types ──

export interface SearchResult {
  chunk: CodeChunk;
  similarity: number;   // 0-1 cosine similarity
  summary: string;
}

export interface SearchResponse {
  query: string;
  answer: string;        // AI-synthesized answer from relevant chunks
  results: SearchResult[];
  tokenUsage: TokenUsage;
}

// ── Configuration ──

export interface AIAnalyzerConfig {
  anthropicApiKey: string;
  analysisModel: string;        // Default: claude-sonnet-4-20250514
  embeddingModel: string;       // Default: claude-haiku-4-5-20251001
  maxFiles: number;             // Default: 20
  maxTokensPerFile: number;     // Default: 8000 chars
  maxTotalInputTokens: number;  // Default: 100000 chars
  embeddingDimensions: number;  // Default: 256
  dbPath: string;               // Default: data/launchpilot.db
  topK: number;                 // Default: 10 for search
}

export const DEFAULT_AI_CONFIG: Omit<AIAnalyzerConfig, 'anthropicApiKey'> = {
  analysisModel: 'claude-sonnet-4-20250514',
  embeddingModel: 'claude-haiku-4-5-20251001',
  maxFiles: 20,
  maxTokensPerFile: 8000,
  maxTotalInputTokens: 100000,
  embeddingDimensions: 256,
  dbPath: 'data/launchpilot.db',
  topK: 10,
};

export const DEFAULT_OLLAMA_CONFIG = {
  analysisModel: 'qwen2.5-coder:14b',
  embeddingModel: 'qwen2.5-coder:7b',
  host: 'http://localhost:11434',
};
