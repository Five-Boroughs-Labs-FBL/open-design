import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveHeroWordmarkInk } from '../../src/components/home-hero/pixel-scan/engine';

const engineSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/home-hero/pixel-scan/engine.ts'),
  'utf8',
);
const logoSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/home-hero/PixelScanLogo.tsx'),
  'utf8',
);

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return -1;
  const n = Number.parseInt(match[1], 16);
  const toLin = (channel: number) => {
    const x = channel / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * toLin((n >> 16) & 255)
    + 0.7152 * toLin((n >> 8) & 255)
    + 0.0722 * toLin(n & 255)
  );
}

describe('hero pixel-scan wordmark ink', () => {
  it('rests on light ink in dark theme so #202020 cannot vanish on graphite', () => {
    expect(relativeLuminance(resolveHeroWordmarkInk('dark'))).toBeGreaterThan(0.7);
    expect(relativeLuminance(resolveHeroWordmarkInk('light'))).toBeLessThan(0.1);
    expect(resolveHeroWordmarkInk('dark', '  #ffffff  ')).toBe('#ffffff');
    expect(resolveHeroWordmarkInk('light', '#17130f')).toBe('#17130f');
  });

  it('tints the SVG mask instead of leaving the baked #202020 fill', () => {
    expect(engineSource).toContain("globalCompositeOperation = 'source-in'");
    expect(engineSource).toContain('resolveHeroWordmarkInk');
    expect(logoSource).toContain('setInk');
    expect(logoSource).toContain('data-theme');
  });
});
