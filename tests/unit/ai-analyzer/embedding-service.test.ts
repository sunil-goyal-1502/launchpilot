import { describe, it, expect } from 'vitest';
import { textToVector } from '../../../src/agents/ai-analyzer/embedding-service.js';

describe('EmbeddingService', () => {
  describe('textToVector', () => {
    it('should produce deterministic vectors', () => {
      const v1 = textToVector('function that handles HTTP requests');
      const v2 = textToVector('function that handles HTTP requests');
      expect(v1).toEqual(v2);
    });

    it('should produce vectors of specified dimensions', () => {
      const v = textToVector('hello world', 128);
      expect(v.length).toBe(128);
    });

    it('should produce default 256-dim vectors', () => {
      const v = textToVector('hello world');
      expect(v.length).toBe(256);
    });

    it('should produce normalized vectors (unit length)', () => {
      const v = textToVector('a test vector for normalization');
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      expect(norm).toBeCloseTo(1, 3);
    });

    it('should produce different vectors for different text', () => {
      const v1 = textToVector('function that handles HTTP requests');
      const v2 = textToVector('database connection pooling utility');
      expect(v1).not.toEqual(v2);
    });

    it('should produce similar vectors for similar text', () => {
      const v1 = textToVector('function that handles HTTP requests');
      const v2 = textToVector('function that processes HTTP requests');
      const v3 = textToVector('database schema migration tool');

      // Cosine similarity between similar texts should be higher
      const sim12 = cosine(v1, v2);
      const sim13 = cosine(v1, v3);
      expect(sim12).toBeGreaterThan(sim13);
    });

    it('should handle empty string', () => {
      const v = textToVector('');
      expect(v.length).toBe(256);
      // All zeros (or close to it) since no words
      expect(v.every(x => x === 0)).toBe(true);
    });

    it('should handle single word', () => {
      const v = textToVector('hello');
      expect(v.length).toBe(256);
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      expect(norm).toBeCloseTo(1, 3);
    });
  });
});

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const d = Math.sqrt(normA) * Math.sqrt(normB);
  return d === 0 ? 0 : dot / d;
}
