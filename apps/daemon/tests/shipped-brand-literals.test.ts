import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RETIRED = /\bOpenDesign\b|Open Design/;
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage']);

const ALLOWED_SUBSTRINGS = [
  'Open Design Preview.app',
  'Open Design Prerelease.app',
  'Open Design Beta.app',
  'Open Design.app',
  'Open Design Preview.exe',
  'Open Design Prerelease.exe',
  'Open Design Beta.exe',
  'Open Design.exe',
  'Open Design Preview',
  'Open Design Prerelease',
  'Open Design Beta',
  '@OpenDesignHQ',
  'OpenDesignHQ',
  'support@open-design.ai',
  'open-design.ai',
  'nexu-io/open-design',
  'od-plugin-contribute-open-design',
  'contribute-open-design',
  'open-design-plugin',
  'open-design-byok',
  'OPEN_DESIGN_BYOK',
  'open-design-homepage',
  'open-design-marketplace',
  'open-design-landing',
  'open-design.json',
  'open-design-config.json',
  'OpenDesign PR',
  'OpenDesign Browser tab',
].sort((a, b) => b.length - a.length);

const SURFACES = [
  'apps/daemon/src',
  'apps/web/src',
  'apps/desktop/src',
  'packages/contracts/src/prompts',
  'README.md',
  'QUICKSTART.md',
  'CONTRIBUTING.md',
  'docs/i18n',
];

function stripAllowed(value: string): string {
  let next = value;
  for (const token of ALLOWED_SUBSTRINGS) next = next.split(token).join('\0');
  return next;
}

function isAllowedLiteral(value: string, rel: string): boolean {
  if (value === 'open-design') return true;
  let candidate = value;
  if (rel.replaceAll('\\', '/').includes('diagnostics-export')) {
    candidate = candidate.replaceAll("'Open Design'", '').replaceAll('"Open Design"', '');
  }
  return !RETIRED.test(stripAllowed(candidate));
}

/** Drop // and /* comments so regex character classes cannot hide later templates. */
export function uncommentedSourceLines(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let line = 1;
  let i = 0;
  let acc = '';
  let block = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (block) {
      if (c === '*' && n === '/') {
        block = false;
        i += 2;
        continue;
      }
      if (c === '\n') {
        out.push({ line, text: acc });
        acc = '';
        line += 1;
      }
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      block = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '\n') {
      out.push({ line, text: acc });
      acc = '';
      line += 1;
      i += 1;
      continue;
    }
    acc += c;
    i += 1;
  }
  out.push({ line, text: acc });
  return out;
}

function walk(rel: string, acc: string[] = []): string[] {
  const full = path.join(REPO_ROOT, rel);
  const st = statSync(full);
  if (st.isDirectory()) {
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(rel, entry.name), acc);
    }
    return acc;
  }
  const ext = path.extname(rel);
  if (CODE_EXT.has(ext) || ext === '.md') acc.push(rel);
  return acc;
}

describe('shipped product literals', () => {
  it('does not quote OpenDesign / Open Design outside the allowlisted non-goals', { timeout: 60_000 }, () => {
    const hits: string[] = [];
    for (const surface of SURFACES) {
      const files = walk(surface);
      for (const rel of files) {
        const norm = rel.replaceAll('\\', '/');
        if (norm.includes('/i18n/locales/') || /\/i18n\/content\./.test(norm)) continue;
        const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        const rows = rel.endsWith('.md')
          ? src.split(/\r?\n/).map((text, i) => ({ line: i + 1, text }))
          : uncommentedSourceLines(src);
        for (const row of rows) {
          if (!isAllowedLiteral(row.text, rel) && RETIRED.test(stripAllowed(row.text))) {
            hits.push(`${rel}:${row.line}:${row.text.trim().slice(0, 180)}`);
          }
        }
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('sees Formalized-by provenance copy in skill-candidates.ts', () => {
    const retiredLine = 'Formalized by OpenDesign from candidate x';
    expect(
      uncommentedSourceLines(retiredLine).some((row) => RETIRED.test(stripAllowed(row.text))),
    ).toBe(true);

    const rel = path.join('apps', 'daemon', 'src', 'plugins', 'skill-candidates.ts');
    const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    expect(src).toMatch(/Formalized by ACP Design from candidate/);
    const hits = uncommentedSourceLines(src)
      .filter((row) => RETIRED.test(stripAllowed(row.text)))
      .map((row) => `${row.line}:${row.text.trim()}`);
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
