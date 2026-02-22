import { createHash } from 'node:crypto';
import { CodeChunk, ChunkType } from '../../types/ai-analysis.js';

/**
 * Splits source files into semantic chunks (functions, classes, routes, blocks).
 * Uses language-aware regex splitting with a sliding-window fallback.
 */

interface RawChunk {
  startLine: number;
  endLine: number;
  content: string;
  chunkType: ChunkType;
  symbolName: string;
}

// ── Language detection ──

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rb': 'ruby',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.json': 'json',
  '.toml': 'toml',
  '.md': 'markdown',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.php': 'php',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return LANG_MAP[ext] ?? 'unknown';
}

// ── Chunk ID generation ──

export function generateChunkId(filePath: string, startLine: number, content: string): string {
  const input = `${filePath}:${startLine}:${content}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ── Language-specific splitters ──

interface BoundaryPattern {
  regex: RegExp;
  chunkType: ChunkType;
  nameExtractor: (match: RegExpMatchArray) => string;
}

const TS_JS_PATTERNS: BoundaryPattern[] = [
  { regex: /^export\s+(?:default\s+)?class\s+(\w+)/m, chunkType: 'class', nameExtractor: m => m[1]! },
  { regex: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/m, chunkType: 'function', nameExtractor: m => m[1]! },
  { regex: /^export\s+const\s+(\w+)\s*=/m, chunkType: 'function', nameExtractor: m => m[1]! },
  { regex: /^(?:app|router)\.(get|post|put|delete|patch|use)\s*\(/m, chunkType: 'route', nameExtractor: m => m[1]! },
  { regex: /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/m, chunkType: 'function', nameExtractor: m => m[1]! },
];

const PYTHON_PATTERNS: BoundaryPattern[] = [
  { regex: /^class\s+(\w+)/m, chunkType: 'class', nameExtractor: m => m[1]! },
  { regex: /^(?:async\s+)?def\s+(\w+)/m, chunkType: 'function', nameExtractor: m => m[1]! },
  { regex: /^@app\.(?:route|get|post|put|delete)\s*\(/m, chunkType: 'route', nameExtractor: () => 'route' },
];

const JAVA_PATTERNS: BoundaryPattern[] = [
  { regex: /^(?:public|private|protected)\s+class\s+(\w+)/m, chunkType: 'class', nameExtractor: m => m[1]! },
  { regex: /^(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/m, chunkType: 'function', nameExtractor: m => m[1]! },
  { regex: /^@(?:RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)/m, chunkType: 'route', nameExtractor: () => 'endpoint' },
];

const GO_PATTERNS: BoundaryPattern[] = [
  { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/m, chunkType: 'function', nameExtractor: m => m[1]! },
  { regex: /^type\s+(\w+)\s+struct/m, chunkType: 'class', nameExtractor: m => m[1]! },
];

const RUBY_PATTERNS: BoundaryPattern[] = [
  { regex: /^class\s+(\w+)/m, chunkType: 'class', nameExtractor: m => m[1]! },
  { regex: /^def\s+(\w+)/m, chunkType: 'function', nameExtractor: m => m[1]! },
  { regex: /^Rails\.application\.routes/m, chunkType: 'route', nameExtractor: () => 'routes' },
];

function getPatternsForLanguage(language: string): BoundaryPattern[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return TS_JS_PATTERNS;
    case 'python':
      return PYTHON_PATTERNS;
    case 'java':
      return JAVA_PATTERNS;
    case 'go':
      return GO_PATTERNS;
    case 'ruby':
      return RUBY_PATTERNS;
    default:
      return [];
  }
}

// ── Config files → single chunk ──

const CONFIG_LANGUAGES = new Set(['yaml', 'json', 'toml']);

function isConfigLanguage(language: string): boolean {
  return CONFIG_LANGUAGES.has(language);
}

// ── Semantic splitting ──

function splitSemantic(lines: string[], patterns: BoundaryPattern[]): RawChunk[] {
  const boundaries: Array<{ line: number; pattern: BoundaryPattern; match: RegExpMatchArray }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart();
    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        boundaries.push({ line: i, pattern, match });
        break; // Only one pattern per line
      }
    }
  }

  if (boundaries.length === 0) return [];

  const chunks: RawChunk[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i]!.line;
    const end = i + 1 < boundaries.length ? boundaries[i + 1]!.line - 1 : lines.length - 1;
    const content = lines.slice(start, end + 1).join('\n');

    // Skip very small chunks (< 2 lines)
    if (end - start < 1) continue;

    chunks.push({
      startLine: start + 1, // 1-indexed
      endLine: end + 1,
      content,
      chunkType: boundaries[i]!.pattern.chunkType,
      symbolName: boundaries[i]!.pattern.nameExtractor(boundaries[i]!.match),
    });
  }

  return chunks;
}

// ── Sliding window fallback ──

const WINDOW_SIZE = 60;
const OVERLAP = 10;

function slidingWindow(lines: string[], fileName: string): RawChunk[] {
  const chunks: RawChunk[] = [];

  for (let i = 0; i < lines.length; i += WINDOW_SIZE - OVERLAP) {
    const end = Math.min(i + WINDOW_SIZE, lines.length);
    const content = lines.slice(i, end).join('\n');

    chunks.push({
      startLine: i + 1,
      endLine: end,
      content,
      chunkType: 'block',
      symbolName: `${fileName}:${i + 1}-${end}`,
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

// ── Public API ──

export function chunkFile(filePath: string, content: string): CodeChunk[] {
  const language = detectLanguage(filePath);
  const lines = content.split('\n');
  const fileName = filePath.split('/').pop() ?? filePath;

  // Config files → one chunk
  if (isConfigLanguage(language)) {
    if (content.trim().length === 0) return [];
    return [{
      id: generateChunkId(filePath, 1, content),
      filePath,
      startLine: 1,
      endLine: lines.length,
      content,
      chunkType: 'config',
      symbolName: fileName,
      language,
    }];
  }

  const patterns = getPatternsForLanguage(language);
  let rawChunks = splitSemantic(lines, patterns);

  // Fall back to sliding window if semantic splitting found nothing
  if (rawChunks.length === 0) {
    rawChunks = slidingWindow(lines, fileName);
  }

  return rawChunks.map(rc => ({
    id: generateChunkId(filePath, rc.startLine, rc.content),
    filePath,
    startLine: rc.startLine,
    endLine: rc.endLine,
    content: rc.content,
    chunkType: rc.chunkType,
    symbolName: rc.symbolName,
    language,
  }));
}

export function chunkFiles(files: Array<{ path: string; content: string }>): CodeChunk[] {
  return files.flatMap(f => chunkFile(f.path, f.content));
}
