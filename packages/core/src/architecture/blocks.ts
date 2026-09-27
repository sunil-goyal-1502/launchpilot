/** Bounded lexical block inventory. Does not pretend to evaluate HCL/Bicep expressions. */
export interface DeclarationBlock { keyword: string; labels: string[]; start: number; end: number; body: string }
export function declarationBlocks(source: string, language: 'terraform' | 'bicep'): DeclarationBlock[] {
  // Mask comments and quoted strings while retaining offsets and newlines for balanced braces.
  const mask = source.split('');
  let quote = '', comment = '', escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) {
      if ((comment === 'line' && c === '\n') || (comment === 'block' && c === '*' && next === '/')) {
        if (comment === 'block') { mask[i] = ' '; mask[++i] = ' '; }
        comment = '';
      } else if (c !== '\n') mask[i] = ' ';
    } else if (quote) {
      if (c !== '\n') mask[i] = ' ';
      if (c === quote && !escaped) quote = '';
      escaped = c === '\\' && !escaped;
    } else if (c === '"' || c === "'") { quote = c; mask[i] = ' '; escaped = false; }
    else if ((c === '/' && next === '/') || c === '#') { comment = 'line'; mask[i] = ' '; }
    else if (c === '/' && next === '*') { comment = 'block'; mask[i] = ' '; }
  }
  const masked = mask.join('');
  const pattern = language === 'terraform'
    ? /\b(resource|data|module|variable|output|provider|terraform)\s*((?:"[^"\n]*"\s*)*)\{/g
    : /\b(resource|module)\s+(\w+)\s+'([^'\n]+)'(?:\s+existing)?\s*=\s*(?:if\s*\([^\n]*\)\s*)?\{/g;
  const result: DeclarationBlock[] = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index!;
    if (masked.slice(start, start + match[1].length) !== match[1]) continue;
    const open = start + match[0].lastIndexOf('{');
    let depth = 1, end = open + 1;
    while (end < source.length && depth > 0) {
      if (masked[end] === '{') depth++;
      if (masked[end] === '}') depth--;
      end++;
    }
    if (depth) continue;
    const labels = language === 'terraform' ? [...match[2].matchAll(/"([^"\n]*)"/g)].map(m => m[1]) : [match[2], match[3]];
    result.push({ keyword: match[1], labels, start, end, body: source.slice(open + 1, end - 1) });
  }
  return result;
}
