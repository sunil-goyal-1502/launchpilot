import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { ParsedMigration, ParsedTable } from '../../../types/index.js';

export async function parseMigrations(
  repoPath: string,
  subDir?: string,
): Promise<ParsedMigration[]> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const migrationsDir = join(basePath, 'supabase', 'migrations');

  if (!existsSync(migrationsDir)) {
    return [];
  }

  let sqlFiles: string[];
  try {
    sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }

  const results: ParsedMigration[] = [];

  for (const filename of sqlFiles) {
    try {
      const content = await readFile(join(migrationsDir, filename), 'utf-8');
      const tables = parseCreateTables(content);
      results.push({ filename, tables });
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}

function parseCreateTables(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = [];

  // Match CREATE TABLE statements with their body
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s*\(([\s\S]*?)\);/gi;

  let match: RegExpExecArray | null;
  while ((match = createTableRegex.exec(sql)) !== null) {
    const tableName = match[1]!;
    const body = match[2]!;

    const columns = parseColumns(body);
    tables.push({ name: tableName, columns });
  }

  return tables;
}

function parseColumns(
  body: string,
): ParsedTable['columns'] {
  const columns: ParsedTable['columns'] = [];

  // Track table-level primary key constraints
  const tablePKMatch = body.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
  const tablePKColumns = new Set<string>();
  if (tablePKMatch?.[1]) {
    for (const col of tablePKMatch[1].split(',')) {
      tablePKColumns.add(col.trim().replace(/["']/g, ''));
    }
  }

  // Split by commas, but be careful about nested parentheses
  const parts = splitColumnDefs(body);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Skip constraints (PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY, CONSTRAINT)
    if (/^\s*(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT)\b/i.test(trimmed)) {
      continue;
    }

    // Parse column: name type [NOT NULL] [PRIMARY KEY] [REFERENCES ...]
    const colMatch = trimmed.match(
      /^["']?(\w+)["']?\s+(\w+(?:\([^)]*\))?(?:\s+(?:VARYING|PRECISION|WITHOUT\s+TIME\s+ZONE|WITH\s+TIME\s+ZONE))?)/i,
    );
    if (!colMatch) continue;

    const name = colMatch[1]!;
    const type = colMatch[2]!;
    const rest = trimmed.slice(colMatch[0].length);

    const nullable = !/NOT\s+NULL/i.test(rest);
    const isPrimaryKey =
      /PRIMARY\s+KEY/i.test(rest) || tablePKColumns.has(name);

    let references: { table: string; column: string } | undefined;
    const refMatch = rest.match(/REFERENCES\s+(?:public\.)?["']?(\w+)["']?\s*\(["']?(\w+)["']?\)/i);
    if (refMatch) {
      references = { table: refMatch[1]!, column: refMatch[2]! };
    }

    columns.push({ name, type, nullable, isPrimaryKey, references });
  }

  return columns;
}

/**
 * Split column definitions by top-level commas (not inside parentheses).
 */
function splitColumnDefs(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of body) {
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}
