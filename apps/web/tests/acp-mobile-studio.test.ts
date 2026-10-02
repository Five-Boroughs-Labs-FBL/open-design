import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ACP mobile Studio embed', () => {
  it('collapses the desktop split to one phone-width surface without affecting standalone Studio', () => {
    const css = fs.readFileSync(path.resolve('src/styles/amc-embed.css'), 'utf8');
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).toContain('html:is([data-amc-embed], [data-acp-embed]) .split {');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('.split.split-focus > .workspace');
    expect(css).toContain('visibility: visible');
    expect(css).not.toMatch(/@media \(max-width: 700px\)[\s\S]*?\n\s*\.split\s*\{/);
  });
});
