import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from 'sql.js';
import { CodeChunk, ChunkEmbedding, IndexedRepo, SearchResult, DEFAULT_AI_CONFIG } from '../../types/ai-analysis.js';

/**
 * SQLite-based vector store for code chunks and embeddings.
 * Uses sql.js (WASM) for zero-config cross-platform support.
 * Cosine similarity is computed in TypeScript (fast for single-repo scale).
 */

export class VectorStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? DEFAULT_AI_CONFIG.dbPath;
  }

  // ── Initialization ──

  async initialize(): Promise<void> {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    // Load existing DB if it exists
    if (this.dbPath !== ':memory:' && existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();
  }

  private createTables(): void {
    this.requireDb().run(`
      CREATE TABLE IF NOT EXISTS indexed_repos (
        repo_url TEXT PRIMARY KEY,
        commit_hash TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        total_chunks INTEGER NOT NULL DEFAULT 0,
        total_files INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS code_chunks (
        id TEXT PRIMARY KEY,
        repo_url TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        chunk_type TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        language TEXT NOT NULL,
        FOREIGN KEY (repo_url) REFERENCES indexed_repos(repo_url) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        chunk_id TEXT PRIMARY KEY,
        repo_url TEXT NOT NULL,
        embedding TEXT NOT NULL,
        summary TEXT NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES code_chunks(id) ON DELETE CASCADE,
        FOREIGN KEY (repo_url) REFERENCES indexed_repos(repo_url) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS analysis_cache (
        repo_url TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (repo_url, commit_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_repo ON code_chunks(repo_url);
      CREATE INDEX IF NOT EXISTS idx_embeddings_repo ON chunk_embeddings(repo_url);
    `);
    const columns = this.requireDb().exec('PRAGMA table_info(indexed_repos)')[0]?.values ?? [];
    if (!columns.some(column => column[1] === 'analysis_fingerprint')) {
      this.requireDb().run('ALTER TABLE indexed_repos ADD COLUMN analysis_fingerprint TEXT');
    }
  }

  private requireDb(): Database {
    if (!this.db) throw new Error('VectorStore not initialized. Call initialize() first.');
    return this.db;
  }

  private persist(): void {
    if (this.dbPath === ':memory:' || !this.db) return;
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  // ── Repo index management ──

  getIndexedRepo(repoUrl: string): IndexedRepo | null {
    const db = this.requireDb();
    const stmt = db.prepare('SELECT * FROM indexed_repos WHERE repo_url = ?');
    stmt.bind([repoUrl]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject();
    stmt.free();

    return {
      repoUrl: row['repo_url'] as string,
      commitHash: row['commit_hash'] as string,
      indexedAt: new Date(row['indexed_at'] as string),
      totalChunks: row['total_chunks'] as number,
      totalFiles: row['total_files'] as number,
      ...(row['analysis_fingerprint'] ? { analysisFingerprint: row['analysis_fingerprint'] as string } : {}),
    };
  }

  isRepoStale(repoUrl: string, currentCommitHash: string): boolean {
    const indexed = this.getIndexedRepo(repoUrl);
    if (!indexed) return true;
    return indexed.commitHash !== currentCommitHash;
  }

  upsertRepoIndex(repo: IndexedRepo): void {
    const db = this.requireDb();
    db.run(
      `INSERT OR REPLACE INTO indexed_repos (repo_url, commit_hash, indexed_at, total_chunks, total_files, analysis_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [repo.repoUrl, repo.commitHash, repo.indexedAt.toISOString(), repo.totalChunks, repo.totalFiles, repo.analysisFingerprint ?? null],
    );
    this.persist();
  }

  // ── Chunk storage ──

  storeChunks(repoUrl: string, chunks: CodeChunk[]): void {
    const db = this.requireDb();

    // Clear existing chunks for this repo
    db.run('DELETE FROM code_chunks WHERE repo_url = ?', [repoUrl]);

    const stmt = db.prepare(
      `INSERT INTO code_chunks (id, repo_url, file_path, start_line, end_line, content, chunk_type, symbol_name, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const chunk of chunks) {
      stmt.run([chunk.id, repoUrl, chunk.filePath, chunk.startLine, chunk.endLine,
        chunk.content, chunk.chunkType, chunk.symbolName, chunk.language]);
    }

    stmt.free();
    this.persist();
  }

  // ── Embedding storage ──

  storeEmbeddings(repoUrl: string, embeddings: ChunkEmbedding[]): void {
    const db = this.requireDb();

    // Clear existing embeddings for this repo
    db.run('DELETE FROM chunk_embeddings WHERE repo_url = ?', [repoUrl]);

    const stmt = db.prepare(
      `INSERT INTO chunk_embeddings (chunk_id, repo_url, embedding, summary)
       VALUES (?, ?, ?, ?)`,
    );

    for (const emb of embeddings) {
      stmt.run([emb.chunkId, repoUrl, JSON.stringify(emb.embedding), emb.summary]);
    }

    stmt.free();
    this.persist();
  }

  // ── Analysis cache ──

  storeAnalysis(repoUrl: string, commitHash: string, analysisJson: string): void {
    const db = this.requireDb();
    db.run(
      `INSERT OR REPLACE INTO analysis_cache (repo_url, commit_hash, analysis_json, created_at)
       VALUES (?, ?, ?, ?)`,
      [repoUrl, commitHash, analysisJson, new Date().toISOString()],
    );
    this.persist();
  }

  getCachedAnalysis(repoUrl: string, commitHash: string): string | null {
    const db = this.requireDb();
    const stmt = db.prepare(
      'SELECT analysis_json FROM analysis_cache WHERE repo_url = ? AND commit_hash = ?',
    );
    stmt.bind([repoUrl, commitHash]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject();
    stmt.free();
    return row['analysis_json'] as string;
  }

  // ── Vector similarity search ──

  searchSimilar(repoUrl: string, queryEmbedding: number[], topK: number = 10): SearchResult[] {
    const db = this.requireDb();

    // Load all embeddings for the repo into memory
    const embStmt = db.prepare(
      `SELECT ce.chunk_id, ce.embedding, ce.summary,
              cc.file_path, cc.start_line, cc.end_line, cc.content,
              cc.chunk_type, cc.symbol_name, cc.language
       FROM chunk_embeddings ce
       JOIN code_chunks cc ON ce.chunk_id = cc.id
       WHERE ce.repo_url = ?`,
    );
    embStmt.bind([repoUrl]);

    const results: SearchResult[] = [];

    while (embStmt.step()) {
      const row = embStmt.getAsObject();
      const embedding: number[] = JSON.parse(row['embedding'] as string);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      results.push({
        chunk: {
          id: row['chunk_id'] as string,
          filePath: row['file_path'] as string,
          startLine: row['start_line'] as number,
          endLine: row['end_line'] as number,
          content: row['content'] as string,
          chunkType: row['chunk_type'] as CodeChunk['chunkType'],
          symbolName: row['symbol_name'] as string,
          language: row['language'] as string,
        },
        similarity,
        summary: row['summary'] as string,
      });
    }

    embStmt.free();

    // Sort by similarity descending, return top-K
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  getChunkCount(repoUrl: string): number {
    const db = this.requireDb();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM code_chunks WHERE repo_url = ?');
    stmt.bind([repoUrl]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row['count'] as number;
  }

  // ── Cleanup ──

  deleteRepo(repoUrl: string): void {
    const db = this.requireDb();
    // CASCADE handles chunks and embeddings
    db.run('DELETE FROM analysis_cache WHERE repo_url = ?', [repoUrl]);
    db.run('DELETE FROM chunk_embeddings WHERE repo_url = ?', [repoUrl]);
    db.run('DELETE FROM code_chunks WHERE repo_url = ?', [repoUrl]);
    db.run('DELETE FROM indexed_repos WHERE repo_url = ?', [repoUrl]);
    this.persist();
  }

  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}

// ── Cosine similarity ──

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
