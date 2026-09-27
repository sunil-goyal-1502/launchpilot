import ts from 'typescript';

export interface SourceRead { key: string; start: number; end: number; kind: 'environment' | 'secret'; client?: string }
export interface SourceImport { library: string; start: number; end: number }

/** Marks offsets outside comments/string literals for non-JS literal-access recognizers. */
export function codeOffsets(text: string, hashComments: boolean): Uint8Array {
  const allowed = new Uint8Array(text.length);
  let quote = '', comment = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (quote.length === 3) { if (text.slice(i, i + 3) === quote) { i += 2; quote = ''; } }
      else { if (c === quote && !escaped) quote = ''; escaped = c === '\\' && !escaped; }
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (hashComments && c === '#') { comment = 'line'; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = hashComments && text.slice(i, i + 3) === c.repeat(3) ? c.repeat(3) : c; if (quote.length === 3) i += 2; escaped = false; continue; }
    allowed[i] = 1;
  }
  return allowed;
}

/** AST-based JS/TS configuration reads, including aliases passed to client constructors. */
export function readTypeScriptConnections(path: string, text: string): { reads: SourceRead[]; imports: SourceImport[] } {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /x$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const reads: SourceRead[] = [], imports: SourceImport[] = [];
  const aliases = new Map<string, SourceRead[]>();
  const clients = new Map<string, string>();
  const libPattern = /^(?:pg|postgres|mysql|mongoose|mongodb|redis|ioredis|bullmq|amqplib|kafkajs|better-sqlite3|sqlite3|sql\.js|@azure\/|@aws-sdk\/)/;
  const literal = (n: ts.Node | undefined) => n && ts.isStringLiteralLike(n) ? n.text : undefined;
  const envKey = (node: ts.Node): string | undefined => {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'process.env') return node.name.text;
    if (ts.isElementAccessExpression(node) && node.expression.getText(source) === 'process.env') return literal(node.argumentExpression);
    return undefined;
  };
  function imported(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && libPattern.test(node.moduleSpecifier.text)) {
      const library = node.moduleSpecifier.text;
      imports.push({ library, start: node.getStart(source), end: node.end });
      if (node.importClause?.name) clients.set(node.importClause.name.text, library);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) clients.set(el.name.text, library);
      if (bindings && ts.isNamespaceImport(bindings)) clients.set(bindings.name.text, library);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'require') {
      const library = literal(node.arguments[0]);
      if (library && libPattern.test(library)) {
        imports.push({ library, start: node.getStart(source), end: node.end });
        if (ts.isVariableDeclaration(node.parent)) clients.set(node.parent.name.getText(source), library);
      }
    }
    ts.forEachChild(node, imported);
  }
  imported(source);
  function gather(node: ts.Node): SourceRead[] {
    const found: SourceRead[] = [];
    const walk = (n: ts.Node) => {
      const key = envKey(n);
      if (key) found.push({ key, start: n.getStart(source), end: n.end, kind: 'environment' });
      else if (ts.isIdentifier(n) && aliases.has(n.text)) found.push(...aliases.get(n.text)!);
      else ts.forEachChild(n, walk);
    };
    walk(node); return found;
  }
  function visit(node: ts.Node) {
    const key = envKey(node);
    if (key) reads.push({ key, start: node.getStart(source), end: node.end, kind: 'environment' });
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) aliases.set(node.name.text, gather(node.initializer));
      else if (ts.isObjectBindingPattern(node.name) && node.initializer.getText(source) === 'process.env') {
        for (const item of node.name.elements) {
          const key = (item.propertyName ?? item.name).getText(source);
          const read: SourceRead = { key, start: item.getStart(source), end: item.end, kind: 'environment' };
          reads.push(read); aliases.set(item.name.getText(source), [read]);
        }
      }
    }
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      const fn = node.expression.getText(source);
      const client = clients.get(fn.split('.')[0]);
      if (client) for (const arg of node.arguments ?? []) for (const read of gather(arg)) reads.push({ ...read, client });
      if (/\.(getSecret|getSecretAsync|GetConnectionString)$/.test(fn)) {
        const key = literal(node.arguments?.[0]);
        if (key) reads.push({ key, start: node.getStart(source), end: node.end, kind: 'secret' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const byLocation = new Map<string, SourceRead>();
  for (const read of reads) {
    const key = `${read.start}:${read.key}`;
    const previous = byLocation.get(key);
    byLocation.set(key, previous?.client && !read.client ? previous : read);
  }
  return { reads: [...byLocation.values()], imports };
}
