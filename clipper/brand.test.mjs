import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RETIRED_BRAND = /(?<![A-Za-z0-9_@])OpenDesign(?![A-Za-z0-9_])|Open Design|\bOpen-Design\b|\bOPENDESIGN\b/;
const TEXT_EXT = new Set(['.js', '.html', '.json', '.md', '.css']);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'icons' || entry.name === 'assets') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (TEXT_EXT.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

describe('clipper shipped copy', () => {
  it('does not show OpenDesign in popup, locales, or store listing', () => {
    const files = walk(ROOT);
    assert.ok(files.some((file) => file.endsWith('popup.html')));
    assert.ok(files.some((file) => file.endsWith(`${path.sep}i18n.js`)));
    for (const file of files) {
      if (!statSync(file).isFile()) continue;
      const text = readFileSync(file, 'utf8');
      assert.equal(RETIRED_BRAND.test(text), false, path.relative(ROOT, file));
    }
  });

  it('names the extension ACP Design Web Clipper', () => {
    const en = JSON.parse(readFileSync(path.join(ROOT, '_locales/en/messages.json'), 'utf8'));
    assert.equal(en.extensionName.message, 'ACP Design Web Clipper');
    assert.match(en.extensionDescription.message, /ACP Design Library/);
    const popup = readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
    assert.match(popup, /<span class="brand-title">ACP Design<\/span>/);
  });
});
