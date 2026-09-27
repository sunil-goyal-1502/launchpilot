import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { RepositoryArchitecture } from '../types/architecture';

export interface RepoFile { path: string; content: string; sha256: string; category: string }
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.terraform', '.venv', 'venv', '__pycache__', 'vendor', 'coverage', '.cache', '.turbo', 'data']);
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|java|cs|rb|rs|php|ya?ml|json|toml|xml|properties|ini|conf|config|tf|tfvars|bicep|bicepparam|sh|ps1|prisma|sql|tpl|hcl)$/i;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function isSecretFile(path: string): boolean {
  const name = basename(path);
  return (/^\.env(?:\.|$)/i.test(name) && !/\.(example|sample|template)$/i.test(name)) || /\.(pem|key|pfx|p12|tfstate)(?:\.|$)/i.test(name) || /^(credentials|id_rsa|id_ed25519)$/.test(name) || /\.tfvars(?:\.json)?$/i.test(name) || /\.bicepparam$/i.test(name);
}
export function category(path: string): string {
  if (/\.tf(?:\.json)?$/.test(path)) return 'terraform';
  if (/\.bicep$/.test(path)) return 'bicep';
  if (/\.(ya?ml|tpl)$/.test(path)) return 'yaml';
  if (/(^|\/)Dockerfile[^/]*$/i.test(path)) return 'docker';
  return 'source';
}
export async function collectRepositoryFiles(root: string, options: Partial<RepositoryArchitecture['coverage']['limits']> = {}) {
  const limits = { maxFiles: 20000, maxFileBytes: 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, ...options };
  const files: RepoFile[] = [];
  const excluded: RepositoryArchitecture['coverage']['excluded'] = [];
  let total = 0;
  let truncated = false;
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(join(root, dir), { withFileTypes: true }); }
    catch { excluded.push({ path: dir || '.', reason: 'unreadable directory' }); truncated = true; return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { excluded.push({ path, reason: 'symbolic link (not followed)' }); continue; }
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) excluded.push({ path, reason: 'generated, dependency or runtime-data directory' });
        else await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSecretFile(path)) { excluded.push({ path, reason: 'secret/state/value file: contents not read' }); continue; }
      if (!SOURCE.test(path) && !/^(Dockerfile.*|Gemfile|Procfile|Makefile|\.env\.(example|sample|template))$/i.test(entry.name)) continue;
      if (/^(package-lock|pnpm-lock|yarn\.lock)/.test(entry.name) || /\.(min\.js|d\.ts)$/.test(path)) continue;
      const stat = await lstat(join(root, path));
      if (files.length >= limits.maxFiles || stat.size > limits.maxFileBytes || total + stat.size > limits.maxTotalBytes) {
        excluded.push({ path, reason: 'scan size limit' }); truncated = true; continue;
      }
      try {
        const content = await readFile(join(root, path), 'utf8');
        if (content.includes('\0')) { excluded.push({ path, reason: 'binary content' }); continue; }
        total += stat.size;
        files.push({ path, content, category: category(path), sha256: hash(content) });
      } catch { excluded.push({ path, reason: 'unreadable file' }); truncated = true; }
    }
  }
  await walk('');
  return { files, excluded, truncated, limits };
}

/** Deliberately no source snippets in the public graph: names and locations suffice as evidence. */
export function safeName(value: unknown, fallback = 'unresolved'): string {
  if (typeof value !== 'string' || value.length > 200 || /[\r\n]|:\/\/[^/]*@|(?:AccountKey|SharedAccessKey|password)=/i.test(value)) return fallback;
  return value;
}
export function sensitiveKey(key: string): boolean { return /password|passwd|secret|token|api.?key|connection.?string|database.?url|redis.?url|private.?key|credential/i.test(key); }
