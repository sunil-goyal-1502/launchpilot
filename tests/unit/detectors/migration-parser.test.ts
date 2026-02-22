import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseMigrations } from '../../../src/agents/ingestion/detectors/migration-parser.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('parseMigrations', () => {
  describe('Lovable app with supabase migrations', () => {
    it('should find 2 migration files', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      expect(result).toHaveLength(2);
    });

    it('should parse migrations in chronological order (by filename)', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      expect(result[0]!.filename).toBe('20240101000000_init.sql');
      expect(result[1]!.filename).toBe('20240102000000_settings.sql');
    });

    it('should parse profiles table from first migration', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      const initMigration = result[0]!;
      const profiles = initMigration.tables.find(t => t.name === 'profiles');
      expect(profiles).toBeDefined();
      expect(profiles!.columns.length).toBeGreaterThanOrEqual(3);
    });

    it('should parse posts table with foreign key reference', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      const initMigration = result[0]!;
      const posts = initMigration.tables.find(t => t.name === 'posts');
      expect(posts).toBeDefined();
      const authorCol = posts!.columns.find(c => c.name === 'author_id');
      expect(authorCol).toBeDefined();
      expect(authorCol!.references).toEqual({ table: 'profiles', column: 'id' });
      expect(authorCol!.nullable).toBe(false);
    });

    it('should parse user_settings table from second migration', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      const settingsMigration = result[1]!;
      const settings = settingsMigration.tables.find(t => t.name === 'user_settings');
      expect(settings).toBeDefined();
    });

    it('should detect primary key columns', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      const profiles = result[0]!.tables.find(t => t.name === 'profiles')!;
      const idCol = profiles.columns.find(c => c.name === 'id');
      expect(idCol).toBeDefined();
      expect(idCol!.isPrimaryKey).toBe(true);
    });

    it('should extract 3 total tables across migrations', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-lovable-app'));
      const totalTables = result.reduce((sum, m) => sum + m.tables.length, 0);
      expect(totalTables).toBe(3);
    });
  });

  describe('Apps without migrations', () => {
    it('should return empty array for app without supabase dir', async () => {
      const result = await parseMigrations(join(fixturesDir, 'sample-nextjs-app'));
      expect(result).toEqual([]);
    });

    it('should return empty array for non-existent directory', async () => {
      const result = await parseMigrations(join(fixturesDir, 'nonexistent'));
      expect(result).toEqual([]);
    });
  });
});
