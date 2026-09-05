import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMBED_GRANT_COOKIE,
  EMBED_GRANT_QUERY,
  EMBED_GRANT_TTL_MS,
  embedGrantAllowsPath,
  mintEmbedGrant,
  readEmbedGrantFromRequest,
  setEmbedGrantCookie,
  verifyEmbedGrant,
  type EmbedGrantPayload,
} from '../src/embed-grants.js';

const API_TOKEN = 'od-api-token-for-hmac';
const OTHER_TOKEN = 'some-other-api-token';
const PROJECT_ID = 'proj_studio_1';
const USER_ID = 'amc_user_42';
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

function signPayload(apiToken: string, payload: unknown): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = createHmac('sha256', apiToken).update(payloadBytes).digest('base64url');
  return `${payloadBytes.toString('base64url')}.${signature}`;
}

function grant(pid = PROJECT_ID): EmbedGrantPayload {
  return {
    v: 1,
    pid,
    uid: USER_ID,
    iat: 1_768_478_400,
    exp: 1_768_521_600,
  };
}

function parseSetCookie(header: string): {
  flags: Set<string>;
  kv: Record<string, string>;
  name: string;
  value: string;
} {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  const first = parts[0] ?? '';
  const eq = first.indexOf('=');
  const name = eq < 0 ? first : first.slice(0, eq);
  const value = eq < 0 ? '' : first.slice(eq + 1);
  const flags = new Set<string>();
  const kv: Record<string, string> = {};
  for (const attr of parts.slice(1)) {
    const idx = attr.indexOf('=');
    if (idx < 0) {
      flags.add(attr.toLowerCase());
      continue;
    }
    kv[attr.slice(0, idx).trim().toLowerCase()] = attr.slice(idx + 1).trim();
  }
  return { flags, kv, name, value };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mintEmbedGrant / verifyEmbedGrant', () => {
  it('round-trips a minted token through verify', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      ttlMs: EMBED_GRANT_TTL_MS,
      userId: USER_ID,
    });
    const iat = Math.floor(FIXED_NOW.getTime() / 1000);
    const exp = Math.floor((FIXED_NOW.getTime() + EMBED_GRANT_TTL_MS) / 1000);

    expect(minted.payload).toEqual({
      v: 1,
      pid: PROJECT_ID,
      uid: USER_ID,
      iat,
      exp,
    });
    expect(minted.expiresAt).toEqual(new Date(exp * 1000));
    expect(minted.token).toBe(signPayload(API_TOKEN, minted.payload));
    expect(verifyEmbedGrant(API_TOKEN, minted.token, FIXED_NOW)).toEqual(minted.payload);
  });

  it('defaults ttl to EMBED_GRANT_TTL_MS (12 hours)', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    expect(EMBED_GRANT_TTL_MS).toBe(12 * 60 * 60 * 1000);
    expect(minted.payload.exp - minted.payload.iat).toBe(12 * 60 * 60);
  });

  it('rejects an expired exp', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      ttlMs: 1000,
      userId: USER_ID,
    });
    const atExpiry = new Date(minted.payload.exp * 1000);
    const afterExpiry = new Date(minted.payload.exp * 1000 + 1);

    expect(verifyEmbedGrant(API_TOKEN, minted.token, atExpiry)).toBeNull();
    expect(verifyEmbedGrant(API_TOKEN, minted.token, afterExpiry)).toBeNull();
    expect(verifyEmbedGrant(API_TOKEN, minted.token, FIXED_NOW)).toEqual(minted.payload);
  });

  it('rejects a tampered payload', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    const [encoded = '', signature = ''] = minted.token.split('.');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EmbedGrantPayload;
    payload.pid = 'proj_other';
    const tampered = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${signature}`;

    expect(verifyEmbedGrant(API_TOKEN, tampered, FIXED_NOW)).toBeNull();
  });

  it('rejects a token signed with the wrong key', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    expect(verifyEmbedGrant(OTHER_TOKEN, minted.token, FIXED_NOW)).toBeNull();
  });

  it('rejects an empty pid even when the HMAC is valid', () => {
    const payload = {
      v: 1 as const,
      pid: '',
      uid: USER_ID,
      iat: Math.floor(FIXED_NOW.getTime() / 1000),
      exp: Math.floor(FIXED_NOW.getTime() / 1000) + 60,
    };
    const token = signPayload(API_TOKEN, payload);
    expect(verifyEmbedGrant(API_TOKEN, token, FIXED_NOW)).toBeNull();
  });

  it('rejects a payload with a bad version', () => {
    const payload = {
      v: 2,
      pid: PROJECT_ID,
      uid: USER_ID,
      iat: Math.floor(FIXED_NOW.getTime() / 1000),
      exp: Math.floor(FIXED_NOW.getTime() / 1000) + 60,
    };
    const token = signPayload(API_TOKEN, payload);
    expect(verifyEmbedGrant(API_TOKEN, token, FIXED_NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyEmbedGrant(API_TOKEN, '', FIXED_NOW)).toBeNull();
    expect(verifyEmbedGrant(API_TOKEN, 'no-dot', FIXED_NOW)).toBeNull();
    expect(verifyEmbedGrant(API_TOKEN, '....', FIXED_NOW)).toBeNull();
  });
});

describe('embed grant cookie and query', () => {
  it('exports the cookie and query names', () => {
    expect(EMBED_GRANT_COOKIE).toBe('od_embed');
    expect(EMBED_GRANT_QUERY).toBe('t');
  });

  it('reads the grant from the od_embed cookie', () => {
    expect(readEmbedGrantFromRequest({
      headers: { cookie: `foo=1; ${EMBED_GRANT_COOKIE}=cookie-token; bar=2` },
    })).toBe('cookie-token');
  });

  it('reads the grant from the t query parameter', () => {
    expect(readEmbedGrantFromRequest({
      query: { [EMBED_GRANT_QUERY]: 'query-token' },
    })).toBe('query-token');
  });

  it('lets the t query win when both cookie and query are present', () => {
    expect(readEmbedGrantFromRequest({
      headers: { cookie: `${EMBED_GRANT_COOKIE}=cookie-token` },
      query: { [EMBED_GRANT_QUERY]: 'query-token' },
    })).toBe('query-token');
  });

  it('returns null when neither cookie nor query is present', () => {
    expect(readEmbedGrantFromRequest({ headers: { cookie: 'other=1' }, query: {} })).toBeNull();
  });

  it('sets an HttpOnly Lax cookie with remaining Max-Age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      ttlMs: 60 * 60 * 1000,
      userId: USER_ID,
    });
    const headers = new Map<string, string>();
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    };

    setEmbedGrantCookie(res, minted.token, minted.expiresAt, { secure: false });

    const parsed = parseSetCookie(headers.get('set-cookie') ?? '');
    expect(parsed.name).toBe(EMBED_GRANT_COOKIE);
    expect(parsed.value).toBe(minted.token);
    expect(parsed.flags.has('httponly')).toBe(true);
    expect(parsed.flags.has('secure')).toBe(false);
    expect(parsed.kv.path).toBe('/');
    expect(parsed.kv.samesite).toBe('Lax');
    expect(parsed.kv['max-age']).toBe('3600');
  });

  it('adds Secure when requested', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const headers = new Map<string, string>();
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    };

    setEmbedGrantCookie(res, 'token-value', new Date(FIXED_NOW.getTime() + 5000), { secure: true });

    const parsed = parseSetCookie(headers.get('set-cookie') ?? '');
    expect(parsed.flags.has('secure')).toBe(true);
    expect(parsed.flags.has('httponly')).toBe(true);
  });
});

describe('embedGrantAllowsPath', () => {
  const g = grant();

  it.each([
    ['GET', '/', {}],
    ['GET', '/index.html', {}],
    ['GET', '/_next/static/chunks/main.js', {}],
    ['GET', '/assets/logo.svg', {}],
    ['GET', '/automations', {}],
    ['GET', '/api/app-config', {}],
    ['GET', '/api/health', {}],
    ['GET', '/api/ready', {}],
    ['GET', '/api/version', {}],
    ['GET', '/health', {}],
    ['GET', '/ready', {}],
    ['GET', '/version', {}],
    ['GET', '/api/projects', {}],
    ['GET', `/api/projects/${PROJECT_ID}`, {}],
    ['GET', `/api/projects/${PROJECT_ID}/files/index.html`, {}],
    ['POST', `/api/projects/${PROJECT_ID}/chat`, {}],
    ['GET', `/projects/${PROJECT_ID}`, {}],
    ['GET', `/projects/${PROJECT_ID}/files/index.html`, {}],
    ['GET', '/api/runs', { projectId: PROJECT_ID }],
    ['POST', '/api/runs', { projectId: PROJECT_ID }],
  ] as const)('allows %s %s', (method, path, query) => {
    expect(embedGrantAllowsPath(g, method, path, query)).toBe(true);
  });

  it.each([
    ['POST', '/api/projects', {}],
    ['GET', '/api/projects/proj_other/files', {}],
    ['GET', '/projects/proj_other', {}],
    ['POST', `/api/projects/${PROJECT_ID}/embed-grants`, {}],
    ['GET', '/api/daemon/status', {}],
    ['PUT', '/api/app-config', {}],
    ['POST', '/api/mcp/servers', {}],
    ['POST', '/api/connectors/composio/config', {}],
    ['POST', '/api/library/ingest', {}],
    ['POST', '/api/plugins/install', {}],
    ['GET', '/api/runs', {}],
    ['GET', '/api/runs', { projectId: 'proj_other' }],
    ['GET', `/api/runs/${PROJECT_ID}`, { projectId: PROJECT_ID }],
    ['GET', '/artifacts/out.html', {}],
    ['GET', '/frames/preview.html', {}],
    ['POST', '/', {}],
  ] as const)('denies %s %s', (method, path, query) => {
    expect(embedGrantAllowsPath(g, method, path, query)).toBe(false);
  });
});
