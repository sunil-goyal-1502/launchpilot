import Database from 'better-sqlite3';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'launchpilot-web.db');

// Persist DB connection across Next.js module re-evaluations (same pattern as store.ts)
const globalForDb = globalThis as unknown as { __launchpilot_db?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__launchpilot_db) {
    globalForDb.__launchpilot_db = new Database(DB_PATH);
    globalForDb.__launchpilot_db.pragma('journal_mode = WAL');
    globalForDb.__launchpilot_db.pragma('foreign_keys = ON');
    globalForDb.__launchpilot_db.exec(SCHEMA);
  }
  return globalForDb.__launchpilot_db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  strategy_tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  live INTEGER NOT NULL DEFAULT 0,
  blueprint_json TEXT,
  strategy_json TEXT,
  security_json TEXT,
  result_json TEXT,
  cost_total REAL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
`;

// --- Types ---

export interface DeploymentRecord {
  id: string;
  repo_url: string;
  repo_name: string;
  provider: string;
  strategy_tier: string;
  status: 'pending' | 'analyzing' | 'planning' | 'deploying' | 'completed' | 'failed' | 'destroyed';
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

// --- CRUD ---

export function createDeployment(params: {
  id: string;
  repoUrl: string;
  repoName: string;
  provider: string;
  strategyTier: string;
  live: boolean;
}): DeploymentRecord {
  const db = getDb();
  db.prepare(`
    INSERT INTO deployments (id, repo_url, repo_name, provider, strategy_tier, live)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params.id, params.repoUrl, params.repoName, params.provider, params.strategyTier, params.live ? 1 : 0);
  return getDeployment(params.id)!;
}

export function getDeployment(id: string): DeploymentRecord | null {
  const db = getDb();
  return db.prepare('SELECT * FROM deployments WHERE id = ?').get(id) as DeploymentRecord | null;
}

export function listDeployments(limit = 50, offset = 0): DeploymentRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM deployments ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as DeploymentRecord[];
}

export function updateDeploymentStatus(id: string, status: DeploymentRecord['status'], extra?: {
  blueprint_json?: string;
  strategy_json?: string;
  security_json?: string;
  result_json?: string;
  cost_total?: number;
  error?: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  const sets: string[] = ['status = ?'];
  const vals: unknown[] = [status];

  if (status === 'analyzing' || status === 'deploying') {
    sets.push('started_at = COALESCE(started_at, ?)');
    vals.push(now);
  }
  if (status === 'completed' || status === 'failed' || status === 'destroyed') {
    sets.push('completed_at = ?');
    vals.push(now);
  }

  if (extra?.blueprint_json) { sets.push('blueprint_json = ?'); vals.push(extra.blueprint_json); }
  if (extra?.strategy_json) { sets.push('strategy_json = ?'); vals.push(extra.strategy_json); }
  if (extra?.security_json) { sets.push('security_json = ?'); vals.push(extra.security_json); }
  if (extra?.result_json) { sets.push('result_json = ?'); vals.push(extra.result_json); }
  if (extra?.cost_total !== undefined) { sets.push('cost_total = ?'); vals.push(extra.cost_total); }
  if (extra?.error) { sets.push('error = ?'); vals.push(extra.error); }

  vals.push(id);
  db.prepare(`UPDATE deployments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getDeploymentStats(): {
  total: number;
  active: number;
  totalCost: number;
  successRate: number;
} {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM deployments').get() as { c: number }).c;
  const active = (db.prepare("SELECT COUNT(*) as c FROM deployments WHERE status IN ('analyzing','planning','deploying')").get() as { c: number }).c;
  const totalCost = (db.prepare('SELECT COALESCE(SUM(cost_total), 0) as c FROM deployments WHERE cost_total IS NOT NULL').get() as { c: number }).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM deployments WHERE status = 'completed'").get() as { c: number }).c;
  const attempted = (db.prepare("SELECT COUNT(*) as c FROM deployments WHERE status IN ('completed','failed')").get() as { c: number }).c;
  const successRate = attempted > 0 ? (completed / attempted) * 100 : 0;

  return { total, active, totalCost, successRate };
}
