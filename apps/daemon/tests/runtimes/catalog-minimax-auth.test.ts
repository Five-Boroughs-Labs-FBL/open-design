import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isCatalogMinimaxByok,
  mergeCatalogMinimaxByok,
  readCatalogMinimaxAuth,
  rememberCatalogMinimaxAuth,
  resolveCatalogMinimaxAuth,
} from '../../src/runtimes/catalog-minimax-auth.ts';

describe('catalog MiniMax stash', () => {
  it('remembers the admin MiniMax key under the catalog user', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-minimax-'));
    const stored = rememberCatalogMinimaxAuth(dataDir, 'user-alice', {
      apiKey: 'sk-admin-minimax',
      baseUrl: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M3',
    });
    expect(stored.apiKey).toBe('sk-admin-minimax');
    expect(stored.model).toBe('MiniMax-M3');
    expect(readCatalogMinimaxAuth(dataDir, 'user-alice')).toEqual(stored);
  });

  it('rejects path-unsafe user ids', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-minimax-bad-'));
    expect(() => rememberCatalogMinimaxAuth(dataDir, '../escape', {
      apiKey: 'sk-x',
    })).toThrow(/userId is invalid/);
    expect(readCatalogMinimaxAuth(dataDir, '../escape')).toBeNull();
  });

  it('detects MiniMax BYOK from model or URL', () => {
    expect(isCatalogMinimaxByok({ model: 'MiniMax-M2.7-highspeed' })).toBe(true);
    expect(isCatalogMinimaxByok({ baseUrl: 'https://api.minimax.io/anthropic' })).toBe(true);
    expect(isCatalogMinimaxByok({ baseUrl: 'https://api.anthropic.com' }, 'claude-opus-5')).toBe(false);
  });

  it('fills an empty BYOK snapshot from the packed admin key', () => {
    const next = mergeCatalogMinimaxByok(
      { protocol: 'anthropic', apiKey: '', baseUrl: '', model: 'MiniMax-M2.7-highspeed' },
      {
        apiKey: 'sk-admin-minimax',
        baseUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M3',
      },
    );
    expect(next.apiKey).toBe('sk-admin-minimax');
    expect(next.model).toBe('MiniMax-M3');
  });

  it('ignores a leftover Settings API key so MiniMax gets the admin vault', () => {
    const next = mergeCatalogMinimaxByok(
      {
        protocol: 'anthropic',
        apiKey: 'sk-ant-leftover',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-opus-4',
      },
      {
        apiKey: 'sk-admin-minimax',
        baseUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.7-highspeed',
      },
    );
    expect(next.apiKey).toBe('sk-admin-minimax');
    expect(next.baseUrl).toBe('https://api.minimax.io/anthropic');
    expect(next.model).toBe('MiniMax-M2.7-highspeed');
  });
});

describe('resolveCatalogMinimaxAuth', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  it('pulls the admin MiniMax key from ACP and remembers it', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-minimax-pull-'));
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        apiKey: 'sk-admin-minimax',
        baseUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.7-highspeed',
      }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no listen port');
    const resolved = await resolveCatalogMinimaxAuth(dataDir, 'user-alice', {
      OD_ACP_BE_URL: `http://127.0.0.1:${address.port}`,
      OD_API_TOKEN: 'token',
    });
    expect(resolved?.apiKey).toBe('sk-admin-minimax');
    expect(seen).toEqual(['GET /api/open-design/minimax-auth?userId=user-alice']);
    expect(readCatalogMinimaxAuth(dataDir, 'user-alice')?.apiKey).toBe('sk-admin-minimax');
  });

  it('refreshes a stale stash from ACP instead of keeping the leftover key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-minimax-refresh-'));
    rememberCatalogMinimaxAuth(dataDir, 'user-alice', {
      apiKey: 'sk-stale-leftover',
      baseUrl: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M2.7-highspeed',
    });
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        apiKey: 'sk-admin-minimax',
        baseUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.7-highspeed',
      }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no listen port');
    const resolved = await resolveCatalogMinimaxAuth(dataDir, 'user-alice', {
      OD_ACP_BE_URL: `http://127.0.0.1:${address.port}`,
      OD_API_TOKEN: 'token',
    });
    expect(resolved?.apiKey).toBe('sk-admin-minimax');
    expect(readCatalogMinimaxAuth(dataDir, 'user-alice')?.apiKey).toBe('sk-admin-minimax');
  });
});
