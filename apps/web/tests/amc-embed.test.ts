import { describe, expect, it } from 'vitest';

import {
  hasEmbedGrantQuery,
  isAmcEmbedSearch,
  rememberEmbedGrantSession,
  OD_EMBED_SESSION_KEY,
} from '../src/amc-embed';

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
});
