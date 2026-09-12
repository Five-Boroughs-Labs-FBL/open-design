import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  applyAmcEmbedFromLocation,
  beginAcpCatalogSignOut,
  clearEmbedGrantSession,
  hasEmbedGrantQuery,
  isAmcEmbedSearch,
  rememberEmbedGrantSession,
  OD_EMBED_SESSION_KEY,
} from '../src/amc-embed';

const embedCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/amc-embed.css'),
  'utf8',
);

describe('ACP embed query aliases', () => {
  it('treats acpEmbed, amcEmbed, and embed as chrome-hiding embeds', () => {
    expect(isAmcEmbedSearch('?acpEmbed=1')).toBe(true);
    expect(isAmcEmbedSearch('?amcEmbed=1')).toBe(true);
    expect(isAmcEmbedSearch('?embed=1')).toBe(true);
    expect(isAmcEmbedSearch('?acpEmbed=0')).toBe(false);
  });

  it('remembers a grant query as an embed session', () => {
    expect(hasEmbedGrantQuery('?t=secret')).toBe(true);
    const store = new Map<string, string>();
    const win = {
      location: { search: '?t=secret' },
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    } as unknown as Window;
    expect(rememberEmbedGrantSession(win)).toBe(true);
    expect(store.get(OD_EMBED_SESSION_KEY)).toBe('1');
  });

  it('clears the remembered grant and replaces history with OD logout', () => {
    const store = new Map<string, string>([[OD_EMBED_SESSION_KEY, '1']]);
    const replace = vi.fn();
    const win = {
      location: { replace },
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    } as unknown as Window;
    beginAcpCatalogSignOut(win);
    expect(store.has(OD_EMBED_SESSION_KEY)).toBe(false);
    expect(replace).toHaveBeenCalledWith('/api/embed-session/logout');
    clearEmbedGrantSession(win);
  });

  it('stamps both embed dataset flags from the grant query', () => {
    const postMessage = vi.fn();
    const win = {
      location: { search: '?amcEmbed=1&t=grant' },
      document: { documentElement: { dataset: {} as Record<string, string> } },
      parent: { postMessage },
      sessionStorage: {
        getItem: () => null,
        setItem: vi.fn(),
      },
    } as unknown as Window;
    expect(applyAmcEmbedFromLocation(win)).toBe(true);
    expect(win.document.documentElement.dataset.amcEmbed).toBe('1');
    expect(win.document.documentElement.dataset.acpEmbed).toBe('1');
  });
});

describe('ACP embed studio ground', () => {
  it('paints an opaque studio fill so Pages/Scripts are not light-on-white', () => {
    expect(embedCss).toMatch(/html:is\(\[data-amc-embed\], \[data-acp-embed\]\)/);
    expect(embedCss).toMatch(/--veil-canvas:\s*var\(--bg\)/);
    expect(embedCss).toMatch(/--app-wash:\s*none/);
    expect(embedCss).toMatch(/\.df-tabs \{\s*background:\s*var\(--bg\)/);
    const htmlBlock = embedCss.match(
      /html:is\(\[data-amc-embed\], \[data-acp-embed\]\) \{[^}]+\}/,
    )?.[0];
    expect(htmlBlock).toBeTruthy();
    expect(htmlBlock).toMatch(/background:\s*var\(--bg-app\)/);
    expect(htmlBlock).not.toMatch(/transparent/);
  });
});
