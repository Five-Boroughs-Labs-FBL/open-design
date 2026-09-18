import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RETIRED_BRAND = /\bOpenDesign\b|Open Design/;
const TEXT_FILES = new Set(['.json', '.md']);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'open-design-homepage') {
        for (const nested of readdirSync(full, { withFileTypes: true })) {
          if (nested.isFile() && TEXT_FILES.has(path.extname(nested.name))) {
            acc.push(path.join(full, nested.name));
          }
        }
        continue;
      }
      walk(full, acc);
      continue;
    }
    if (TEXT_FILES.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

describe('official plugin gallery copy', () => {
  it('names ACP Design instead of OpenDesign in manifests and skill descriptions', () => {
    const roots = [
      path.join(REPO_ROOT, 'plugins/_official'),
      path.join(REPO_ROOT, 'plugins/registry'),
    ];
    const files = roots.flatMap((root) => walk(root));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      if (!statSync(file).isFile()) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, path.relative(REPO_ROOT, file)).not.toMatch(RETIRED_BRAND);
    }
  });
});
