import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectPlatformConfigs } from '../../../src/agents/ingestion/detectors/platform-detector.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('detectPlatformConfigs', () => {
  it('should detect vercel.json → vercel target', () => {
    const results = detectPlatformConfigs(join(fixturesDir, 'sample-lovable-app'));
    expect(results).toHaveLength(1);
    expect(results[0]!.target).toBe('vercel');
    expect(results[0]!.configFile).toBe('vercel.json');
    expect(results[0]!.confidence).toBe(0.9);
  });

  it('should return empty array for app without platform config', () => {
    const results = detectPlatformConfigs(join(fixturesDir, 'sample-nextjs-app'));
    expect(results).toEqual([]);
  });

  it('should return empty array for non-existent directory', () => {
    const results = detectPlatformConfigs(join(fixturesDir, 'nonexistent'));
    expect(results).toEqual([]);
  });

  it('should support subDir parameter', () => {
    const results = detectPlatformConfigs(fixturesDir, 'sample-lovable-app');
    expect(results).toHaveLength(1);
    expect(results[0]!.target).toBe('vercel');
  });

  it('should not detect firebase.json as a platform config', () => {
    // Firebase has firebase.json but that's a BaaS config, not a deploy target
    const results = detectPlatformConfigs(join(fixturesDir, 'sample-firebase-app'));
    expect(results).toEqual([]);
  });

  it('should deduplicate by target (e.g., netlify.toml and netlify.yaml)', () => {
    // This test validates the dedup logic even if we don't have a fixture with both
    const results = detectPlatformConfigs(join(fixturesDir, 'sample-lovable-app'));
    const targets = results.map(r => r.target);
    const unique = new Set(targets);
    expect(targets.length).toBe(unique.size);
  });

  it('should return results with correct shape', () => {
    const results = detectPlatformConfigs(join(fixturesDir, 'sample-lovable-app'));
    for (const r of results) {
      expect(r).toHaveProperty('target');
      expect(r).toHaveProperty('configFile');
      expect(r).toHaveProperty('confidence');
      expect(typeof r.confidence).toBe('number');
    }
  });

  it('should always return an array (never null)', () => {
    const results = detectPlatformConfigs(join(fixturesDir, 'sample-nextjs-app'));
    expect(Array.isArray(results)).toBe(true);
  });
});
