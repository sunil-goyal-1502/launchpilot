import { describe, it, expect } from 'vitest';
import { chunkFile, chunkFiles, detectLanguage, generateChunkId } from '../../../src/agents/ai-analyzer/code-chunker.js';

describe('CodeChunker', () => {
  describe('detectLanguage', () => {
    it('should detect TypeScript', () => {
      expect(detectLanguage('src/app.ts')).toBe('typescript');
      expect(detectLanguage('component.tsx')).toBe('typescript');
    });

    it('should detect JavaScript', () => {
      expect(detectLanguage('index.js')).toBe('javascript');
      expect(detectLanguage('config.mjs')).toBe('javascript');
    });

    it('should detect Python', () => {
      expect(detectLanguage('app.py')).toBe('python');
    });

    it('should detect Go', () => {
      expect(detectLanguage('main.go')).toBe('go');
    });

    it('should return unknown for unrecognized extensions', () => {
      expect(detectLanguage('file.xyz')).toBe('unknown');
    });
  });

  describe('generateChunkId', () => {
    it('should generate deterministic IDs', () => {
      const id1 = generateChunkId('src/app.ts', 1, 'const x = 1;');
      const id2 = generateChunkId('src/app.ts', 1, 'const x = 1;');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different content', () => {
      const id1 = generateChunkId('src/app.ts', 1, 'const x = 1;');
      const id2 = generateChunkId('src/app.ts', 1, 'const x = 2;');
      expect(id1).not.toBe(id2);
    });

    it('should generate 16-character hex IDs', () => {
      const id = generateChunkId('file.ts', 1, 'content');
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('chunkFile', () => {
    it('should chunk TypeScript with exported functions', () => {
      const content = `import { foo } from './bar';

export function handleRequest(req: Request) {
  const body = req.body;
  return new Response(JSON.stringify(body));
}

export function handleError(err: Error) {
  console.error(err);
  return new Response('Error', { status: 500 });
}`;

      const chunks = chunkFile('src/handler.ts', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.some(c => c.symbolName === 'handleRequest')).toBe(true);
      expect(chunks.some(c => c.symbolName === 'handleError')).toBe(true);
      expect(chunks[0]!.language).toBe('typescript');
      expect(chunks[0]!.chunkType).toBe('function');
    });

    it('should chunk TypeScript with exported classes', () => {
      const content = `export class UserService {
  async findAll() {
    return [];
  }
}

export class AuthService {
  async login(email: string) {
    return { token: 'abc' };
  }
}`;

      const chunks = chunkFile('src/services.ts', content);
      expect(chunks.some(c => c.symbolName === 'UserService')).toBe(true);
      expect(chunks.some(c => c.symbolName === 'AuthService')).toBe(true);
      expect(chunks[0]!.chunkType).toBe('class');
    });

    it('should chunk Python with functions and classes', () => {
      const content = `import os

class UserModel:
    def __init__(self, name):
        self.name = name
    def save(self):
        db.session.add(self)
        db.session.commit()

def get_users():
    return UserModel.query.all()

def create_user(name):
    user = UserModel(name)
    db.session.add(user)
    return user`;

      const chunks = chunkFile('app/models.py', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // Should detect class and standalone functions
      expect(chunks.some(c => c.chunkType === 'class' || c.chunkType === 'function')).toBe(true);
      expect(chunks[0]!.language).toBe('python');
    });

    it('should chunk Go with functions and structs', () => {
      const content = `type Server struct {
    Port int
    Host string
}

func NewServer(port int) *Server {
    return &Server{Port: port}
}

func (s *Server) Start() error {
    return http.ListenAndServe(fmt.Sprintf(":%d", s.Port), nil)
}`;

      const chunks = chunkFile('main.go', content);
      expect(chunks.some(c => c.symbolName === 'Server')).toBe(true);
      expect(chunks.some(c => c.symbolName === 'NewServer')).toBe(true);
      expect(chunks[0]!.language).toBe('go');
    });

    it('should treat JSON files as single config chunks', () => {
      const content = '{"name": "test", "version": "1.0.0"}';
      const chunks = chunkFile('package.json', content);
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.chunkType).toBe('config');
      expect(chunks[0]!.language).toBe('json');
    });

    it('should treat YAML files as single config chunks', () => {
      const content = 'version: "3"\nservices:\n  app:\n    build: .';
      const chunks = chunkFile('docker-compose.yml', content);
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.chunkType).toBe('config');
    });

    it('should fall back to sliding window for unknown languages', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      const content = lines.join('\n');
      const chunks = chunkFile('readme.txt', content);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.chunkType).toBe('block');
    });

    it('should return empty for empty config files', () => {
      const chunks = chunkFile('empty.json', '');
      expect(chunks.length).toBe(0);
    });

    it('should generate unique IDs per chunk', () => {
      const content = `export function foo() { return 1; }

export function bar() { return 2; }`;

      const chunks = chunkFile('test.ts', content);
      const ids = chunks.map(c => c.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe('chunkFiles', () => {
    it('should chunk multiple files', () => {
      const files = [
        { path: 'a.ts', content: 'export function a() { return 1; }\n\nexport function b() { return 2; }' },
        { path: 'b.json', content: '{"key": "value"}' },
      ];

      const chunks = chunkFiles(files);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.some(c => c.filePath === 'a.ts')).toBe(true);
      expect(chunks.some(c => c.filePath === 'b.json')).toBe(true);
    });
  });
});
