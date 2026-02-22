import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { ApplicationBlueprint } from '../../types/index.js';
import { AIAnalyzerConfig, DEFAULT_AI_CONFIG } from '../../types/ai-analysis.js';

/**
 * Selects the most informative source files from a repo, budget-aware.
 * Priority scoring: entry points > routes > config > models > services > other.
 */

export interface SelectedFile {
  path: string;        // Relative path within repo
  content: string;
  priority: number;    // 1-10
  tokenEstimate: number;
}

// ── Directories/files to always skip ──

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'env', '.tox', 'target', 'vendor', 'coverage',
  '.nyc_output', '.cache', '.parcel-cache', '.turbo',
]);

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.rar',
  '.pdf', '.doc', '.docx',
  '.lock', '.map',
  '.min.js', '.min.css',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rb', '.rs', '.cs', '.php',
  '.yml', '.yaml', '.json', '.toml', '.xml',
  '.md', '.env.example', '.dockerfile',
]);

// ── Priority scoring ──

function scorePriority(relPath: string): number {
  const lower = relPath.toLowerCase();
  const fileName = lower.split('/').pop() ?? '';

  // 10: Entry points
  if (/^(src\/)?(index|main|app|server)\.(ts|js|py|go|rb)$/.test(lower)) return 10;
  if (fileName === 'main.py' || fileName === 'app.py' || fileName === 'manage.py') return 10;
  if (fileName === 'main.go' || fileName === 'cmd/main.go') return 10;

  // 9: Routes, controllers, handlers, API
  if (/\/(routes?|controllers?|handlers?|api|endpoints?)\//i.test(lower)) return 9;
  if (/route\.(ts|js)$/.test(fileName)) return 9;  // Next.js route files

  // 8: Config files
  if (/^(docker-compose|dockerfile)/i.test(fileName)) return 8;
  if (fileName === '.env.example' || fileName === '.env.sample') return 8;
  if (/^(next|vite|webpack|rollup|tsconfig|nest-cli|angular)\./.test(fileName)) return 8;

  // 7: Models, schemas, entities
  if (/\/(models?|schemas?|entities|prisma)\//i.test(lower)) return 7;
  if (/schema\.(ts|js|py|rb)$/.test(fileName)) return 7;
  if (fileName === 'schema.prisma') return 7;

  // 6: Middleware, auth, security
  if (/\/(middleware|auth|security|guards?)\//i.test(lower)) return 6;
  if (/middleware\.(ts|js|py)$/.test(fileName)) return 6;

  // 5: Services, lib, domain, README
  if (/\/(services?|lib|domain|core|utils?)\//i.test(lower)) return 5;
  if (fileName === 'readme.md') return 5;

  // 4: Other source files
  const ext = extname(lower);
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rb', '.rs'].includes(ext)) return 4;

  // 3: Test files
  if (/\/(tests?|__tests__|spec)\//i.test(lower) || /\.(test|spec)\./i.test(lower)) return 3;

  // 2: Other config
  if (['.yml', '.yaml', '.json', '.toml', '.xml'].includes(ext)) return 2;

  return 1;
}

// ── Recursive file discovery ──

function discoverFiles(dir: string, basePath: string): Array<{ absPath: string; relPath: string }> {
  const results: Array<{ absPath: string; relPath: string }> = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.env.example' && entry !== '.env.sample') continue;
    if (SKIP_DIRS.has(entry)) continue;

    const absPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(absPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...discoverFiles(absPath, basePath));
    } else if (stat.isFile()) {
      const relPath = relative(basePath, absPath).replace(/\\/g, '/');
      const ext = extname(entry).toLowerCase();

      // Skip binary/non-source files
      if (SKIP_EXTENSIONS.has(ext)) continue;

      // Check if it's a recognized source file or known special file
      const isSource = SOURCE_EXTENSIONS.has(ext) ||
        entry === 'Dockerfile' ||
        entry === 'Gemfile' ||
        entry === 'Makefile' ||
        entry === 'go.sum';

      if (isSource) {
        results.push({ absPath, relPath });
      }
    }
  }

  return results;
}

// ── Rough token estimation (~4 chars per token) ──

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Public API ──

export function selectFiles(
  repoPath: string,
  _blueprint?: ApplicationBlueprint,
  config?: Partial<Pick<AIAnalyzerConfig, 'maxFiles' | 'maxTokensPerFile' | 'maxTotalInputTokens'>>,
): SelectedFile[] {
  const maxFiles = config?.maxFiles ?? DEFAULT_AI_CONFIG.maxFiles;
  const maxTokensPerFile = config?.maxTokensPerFile ?? DEFAULT_AI_CONFIG.maxTokensPerFile;
  const maxTotalTokens = config?.maxTotalInputTokens ?? DEFAULT_AI_CONFIG.maxTotalInputTokens;

  // Discover all source files
  const discovered = discoverFiles(repoPath, repoPath);

  // Score and sort by priority (desc), then alphabetically for stability
  const scored = discovered.map(f => ({
    ...f,
    priority: scorePriority(f.relPath),
  }));
  scored.sort((a, b) => b.priority - a.priority || a.relPath.localeCompare(b.relPath));

  // Read files with budget enforcement
  const selected: SelectedFile[] = [];
  let totalTokens = 0;

  for (const file of scored) {
    if (selected.length >= maxFiles) break;
    if (totalTokens >= maxTotalTokens) break;

    let content: string;
    try {
      content = readFileSync(file.absPath, 'utf-8');
    } catch {
      continue;
    }

    // Truncate large files
    if (content.length > maxTokensPerFile) {
      content = content.slice(0, maxTokensPerFile) + '\n// ... (truncated)';
    }

    const tokens = estimateTokens(content);
    if (totalTokens + tokens > maxTotalTokens) {
      // Try to fit a truncated version
      const remaining = maxTotalTokens - totalTokens;
      if (remaining > 100) {
        content = content.slice(0, remaining * 4) + '\n// ... (truncated)';
      } else {
        break;
      }
    }

    totalTokens += estimateTokens(content);
    selected.push({
      path: file.relPath,
      content,
      priority: file.priority,
      tokenEstimate: estimateTokens(content),
    });
  }

  return selected;
}
