import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const logoPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/logo-scan.svg',
);

describe('home hero lockup SVG', () => {
  it('ships an ACP Design wordmark for PixelScanLogo to sample', () => {
    const svg = readFileSync(logoPath, 'utf8');
    expect(svg).toContain('ACP Design');
    expect(svg).not.toMatch(/(?<!@)OpenDesign(?!HQ)/);
    expect(svg).not.toContain('Open Design');
  });
});
