import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyAmcGrokHome } from '../../src/runtimes/amc-grok.ts';
import {
  fetchCatalogGrokAuthFromAcp,
  readCatalogGrokAuth,
  rememberCatalogGrokAuth,
  resolveCatalogGrokForwarding,
} from '../../src/runtimes/catalog-grok-auth.ts';

const AUTH_JSON = '{"refresh_token":"super-grok-from-vault"}';

describe('catalog SuperGrok stash', () => {
  it('remembers vault auth.json under the catalog user home', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-grok-'));
    const stored = rememberCatalogGrokAuth(dataDir, 'user-alice', AUTH_JSON);
    expect(stored.grokHome).toBe(join(dataDir, 'catalog-grok-homes', 'user-alice'));
    expect(readFileSync(join(stored.grokHome, 'auth.json'), 'utf8')).toBe(AUTH_JSON);
    const read = readCatalogGrokAuth(dataDir, 'user-alice');
    expect(read?.authJson).toBe(AUTH_JSON);
    expect(read?.grokHome).toBe(stored.grokHome);
  });

  it('rejects path-unsafe user ids', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-grok-bad-'));
    expect(() => rememberCatalogGrokAuth(dataDir, '../escape', AUTH_JSON)).toThrow(
      /userId is invalid/,
    );
    expect(readCatalogGrokAuth(dataDir, '../escape')).toBeNull();
  });

  it('strips host XAI keys so SuperGrok auth.json is the login', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-grok-strip-'));
    const stored = rememberCatalogGrokAuth(dataDir, 'user-alice', AUTH_JSON);
    const env = applyAmcGrokHome(
      {
        PATH: '/bin',
        XAI_API_KEY: 'host-paid-key',
        GROK_CODE_XAI_API_KEY: 'also-host',
      },
      stored,
    );
    expect(env.GROK_HOME).toBe(stored.grokHome);
    expect(env.XAI_API_KEY).toBeUndefined();
    expect(env.GROK_CODE_XAI_API_KEY).toBeUndefined();
  });
});

describe('resolveCatalogGrokForwarding', () => {
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

  it('returns the stash without calling ACP', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-grok-hit-'));
    rememberCatalogGrokAuth(dataDir, 'user-alice', AUTH_JSON);
    const resolved = await resolveCatalogGrokForwarding(dataDir, 'user-alice', {
      OD_ACP_BE_URL: 'http://127.0.0.1:1',
      OD_API_TOKEN: 'token',
    });
    expect(resolved?.authJson).toBe(AUTH_JSON);
  });

  it('pulls auth.json from ACP and remembers it', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'od-catalog-grok-pull-'));
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      expect(req.headers.authorization).toBe('Bearer od-token');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ authJson: AUTH_JSON }));
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('stub did not bind');
    const resolved = await resolveCatalogGrokForwarding(dataDir, 'user-alice', {
      OD_ACP_BE_URL: `http://127.0.0.1:${addr.port}`,
      OD_API_TOKEN: 'od-token',
    });
    expect(seen).toEqual(['GET /api/open-design/grok-auth?userId=user-alice']);
    expect(resolved?.authJson).toBe(AUTH_JSON);
    expect(readCatalogGrokAuth(dataDir, 'user-alice')?.authJson).toBe(AUTH_JSON);
  });

  it('pulls from the ACP SSO origin when OD_ACP_BE_URL is unset', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ authJson: AUTH_JSON }));
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('stub did not bind');
    const authJson = await fetchCatalogGrokAuthFromAcp('user-alice', {
      OD_ACP_SSO_URL: `http://127.0.0.1:${addr.port}/open-design/sso`,
      OD_API_TOKEN: 'od-token',
    });
    expect(seen).toEqual(['GET /api/open-design/grok-auth?userId=user-alice']);
    expect(authJson).toBe(AUTH_JSON);
  });

  it('returns empty when ACP has no SuperGrok session', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'GROK_AUTH_NOT_FOUND' }));
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('stub did not bind');
    const authJson = await fetchCatalogGrokAuthFromAcp('user-alice', {
      OD_ACP_BE_URL: `http://127.0.0.1:${addr.port}`,
      OD_API_TOKEN: 'od-token',
    });
    expect(authJson).toBe('');
  });
});
