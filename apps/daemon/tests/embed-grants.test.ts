import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CATALOG_EMBED_GRANT_PID,
  EMBED_GRANT_COOKIE,
  EMBED_GRANT_QUERY,
  EMBED_GRANT_TTL_MS,
  applyVerifiedEmbedGrant,
  clearEmbedGrantCookie,
  embedGrantAllowsPath,
  embedGrantAllowsProjectId,
  embedGrantAllowsProjectRecord,
  embedGrantCookieShouldBeSecure,
  embedGrantForbidsRequest,
  filterProjectsForEmbedGrant,
  isCatalogAdminEmbedGrant,
  isCatalogEmbedGrant,
  isEmbedGrantDeferredRunLookupPath,
  mintEmbedGrant,
  projectAcpUserId,
  publicEmbedSessionFromGrant,
  readEmbedGrantFromRequest,
  setEmbedGrantCookie,
  stampCatalogOwnerMetadata,
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

  it('round-trips a catalog grant with legacy project ids', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      projectIds: ['legacy-1', 'legacy-1', 'legacy-2'],
      userId: USER_ID,
    });
    expect(minted.payload.pid).toBe('*');
    expect(minted.payload.pids).toEqual(['legacy-1', 'legacy-2']);
    expect(minted.payload.adm).toBeUndefined();
    expect(verifyEmbedGrant(API_TOKEN, minted.token, FIXED_NOW)).toEqual(minted.payload);
  });

  it('stamps adm only on catalog grants and round-trips it', () => {
    const projectScoped = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: PROJECT_ID,
      userId: USER_ID,
      admin: true,
    });
    expect(projectScoped.payload.adm).toBeUndefined();
    expect(isCatalogAdminEmbedGrant(projectScoped.payload)).toBe(false);

    const catalog = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      userId: USER_ID,
      admin: true,
    });
    expect(catalog.payload.adm).toBe(true);
    expect(isCatalogAdminEmbedGrant(catalog.payload)).toBe(true);
    expect(verifyEmbedGrant(API_TOKEN, catalog.token, FIXED_NOW)).toEqual(catalog.payload);
    expect(publicEmbedSessionFromGrant(catalog.payload)).toEqual({
      uid: USER_ID,
      catalog: true,
      admin: true,
    });
  });

  it('does not treat a forged adm field without a matching HMAC as admin', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      userId: USER_ID,
    });
    const [encoded = '', signature = ''] = minted.token.split('.');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EmbedGrantPayload;
    payload.adm = true;
    const tampered = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${signature}`;
    expect(verifyEmbedGrant(API_TOKEN, tampered, FIXED_NOW)).toBeNull();
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

  it('clears the embed cookie as an expired HttpOnly session cookie', () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    };
    clearEmbedGrantCookie(res, { secure: true });
    const parsed = parseSetCookie(headers.get('set-cookie') ?? '');
    expect(parsed.name).toBe(EMBED_GRANT_COOKIE);
    expect(parsed.value).toBe('');
    expect(parsed.kv['max-age']).toBe('0');
    expect(parsed.flags.has('httponly')).toBe(true);
    expect(parsed.flags.has('secure')).toBe(true);
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
    ['GET', '/api/public-runtime', {}],
    ['GET', '/api/agents', {}],
    ['GET', '/api/agents?stream=1', {}],
    ['HEAD', '/api/agents', {}],
    ['GET', '/api/skills', {}],
    ['GET', '/api/skills/html-prototype', {}],
    ['GET', '/api/design-templates', {}],
    ['GET', '/api/design-systems', {}],
    ['GET', '/api/prompt-templates', {}],
    ['GET', '/api/atoms', {}],
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
    ['POST', '/api/chat', { projectId: PROJECT_ID }],
  ] as const)('allows %s %s', (method, path, query) => {
    expect(embedGrantAllowsPath(g, method, path, query)).toBe(true);
  });

  it.each([
    ['POST', '/api/embed-grants', {}],
    ['POST', '/api/projects', {}],
    ['GET', '/api/projects/proj_other/files', {}],
    ['GET', '/projects/proj_other', {}],
    ['POST', `/api/projects/${PROJECT_ID}/embed-grants`, {}],
    ['GET', '/api/daemon/status', {}],
    ['PUT', '/api/app-config', {}],
    ['POST', '/api/agents/grok-build/oauth-launch', {}],
    ['POST', '/api/agents/claude/companion/install', {}],
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

describe('embed grant request helpers', () => {
  const g = grant();

  it('treats /api/runs/:id as a deferred lookup and blocks by-plugin-workflow', () => {
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/run_abc')).toBe(true);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/run_abc/events')).toBe(true);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/run_abc/agui')).toBe(true);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/run_abc/result-package')).toBe(true);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/run_abc/cancel')).toBe(true);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs')).toBe(false);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/run_abc/genui')).toBe(false);
    expect(isEmbedGrantDeferredRunLookupPath('/api/runs/by-plugin-workflow/wf_1')).toBe(false);
  });

  it('does not forbid deferred run-id paths even though the path helper denies them', () => {
    expect(embedGrantForbidsRequest(g, { method: 'GET', originalUrl: '/api/runs/run_abc' })).toBe(false);
    expect(embedGrantForbidsRequest(g, {
      method: 'GET',
      originalUrl: '/api/runs/by-plugin-workflow/wf_1',
    })).toBe(true);
  });

  it('authorizes POST /api/runs from the body projectId, not the query', () => {
    expect(embedGrantForbidsRequest(g, {
      body: { projectId: PROJECT_ID },
      method: 'POST',
      originalUrl: '/api/runs',
    })).toBe(false);
    expect(embedGrantForbidsRequest(g, {
      body: { projectId: 'proj_other' },
      method: 'POST',
      originalUrl: '/api/runs',
      query: { projectId: PROJECT_ID },
    })).toBe(true);
    expect(embedGrantForbidsRequest(g, {
      method: 'POST',
      originalUrl: '/api/runs',
      query: { projectId: PROJECT_ID },
    })).toBe(true);
    expect(embedGrantForbidsRequest(g, {
      body: { projectId: PROJECT_ID },
      method: 'POST',
      originalUrl: '/api/chat',
    })).toBe(false);
    expect(embedGrantForbidsRequest(g, {
      body: { projectId: 'proj_other' },
      method: 'POST',
      originalUrl: '/api/chat',
    })).toBe(true);
  });

  it('filters the project list to the grant pid and no-ops without a grant', () => {
    const projects = [{ id: 'proj_other' }, { id: PROJECT_ID }, { id: 'proj_three' }];
    expect(filterProjectsForEmbedGrant(g, projects)).toEqual([{ id: PROJECT_ID }]);
    expect(filterProjectsForEmbedGrant(undefined, projects)).toEqual(projects);
    expect(embedGrantAllowsProjectId(undefined, 'proj_other')).toBe(true);
    expect(embedGrantAllowsProjectId(g, PROJECT_ID)).toBe(true);
    expect(embedGrantAllowsProjectId(g, 'proj_other')).toBe(false);
  });

  it('filters a catalog grant to ACP-owned and allowlisted projects', () => {
    const catalog = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      projectIds: ['legacy-1'],
      userId: USER_ID,
    }).payload;
    expect(isCatalogEmbedGrant(catalog)).toBe(true);
    const projects = [
      { id: 'legacy-1', metadata: {} },
      { id: 'owned-2', metadata: { acpUserId: USER_ID } },
      { id: 'other-3', metadata: { acpUserId: 'someone-else' } },
    ];
    expect(filterProjectsForEmbedGrant(catalog, projects).map((p) => p.id)).toEqual([
      'legacy-1',
      'owned-2',
    ]);
    expect(embedGrantAllowsProjectRecord(catalog, projects[1])).toBe(true);
    expect(embedGrantAllowsProjectRecord(catalog, projects[2])).toBe(false);
    expect(projectAcpUserId(projects[1])).toBe(USER_ID);
    expect(stampCatalogOwnerMetadata({ kind: 'other' }, catalog)).toEqual({
      kind: 'other',
      acpUserId: USER_ID,
      acp: true,
    });
  });

  it('lets a catalog grant create projects and denies minting more grants', () => {
    const catalog = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      userId: USER_ID,
    }).payload;
    expect(embedGrantAllowsPath(catalog, 'POST', '/api/projects')).toBe(true);
    expect(embedGrantAllowsPath(catalog, 'GET', '/api/projects')).toBe(true);
    expect(embedGrantAllowsPath(catalog, 'GET', '/api/public-runtime')).toBe(true);
    expect(embedGrantAllowsPath(catalog, 'GET', '/api/skills')).toBe(true);
    expect(embedGrantAllowsPath(catalog, 'GET', '/api/design-templates')).toBe(true);
    expect(embedGrantAllowsPath(catalog, 'GET', '/api/design-systems')).toBe(true);
    expect(embedGrantAllowsPath(catalog, 'POST', '/api/skills/install')).toBe(false);
    expect(embedGrantAllowsPath(catalog, 'POST', '/api/embed-grants')).toBe(false);
    expect(embedGrantAllowsPath(catalog, 'PUT', '/api/app-config')).toBe(false);
    expect(embedGrantAllowsPath(catalog, 'GET', '/api/embed-session/logout')).toBe(true);
    expect(embedGrantForbidsRequest(catalog, {
      method: 'GET',
      originalUrl: '/api/projects/owned-2',
    }, (id) => (id === 'owned-2' ? { id, metadata: { acpUserId: USER_ID } } : null))).toBe(false);
    expect(embedGrantForbidsRequest(catalog, {
      method: 'GET',
      originalUrl: '/api/projects/other-3',
    }, (id) => (id === 'other-3' ? { id, metadata: { acpUserId: 'nope' } } : null))).toBe(true);
    expect(embedGrantForbidsRequest(catalog, {
      method: 'GET',
      originalUrl: '/api/projects/owned-2',
    })).toBe(true);
    expect(embedGrantAllowsProjectId(catalog, 'guessed-id')).toBe(false);
  });

  it('lets only catalog admin grants persist process-wide app-config', () => {
    const admin = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      userId: USER_ID,
      admin: true,
    }).payload;
    expect(embedGrantAllowsPath(admin, 'PUT', '/api/app-config')).toBe(true);
    expect(embedGrantAllowsPath(admin, 'POST', '/api/plugins/install')).toBe(false);
    expect(publicEmbedSessionFromGrant(admin)).toEqual({
      uid: USER_ID,
      catalog: true,
      admin: true,
    });
  });

  it('lets a catalog grant POST /api/chat only for ACP-owned projects', () => {
    const catalog = mintEmbedGrant(API_TOKEN, {
      now: FIXED_NOW,
      projectId: CATALOG_EMBED_GRANT_PID,
      userId: USER_ID,
    }).payload;
    const lookup = (id: string) => {
      if (id === 'owned-2') return { id, metadata: { acpUserId: USER_ID } };
      if (id === 'other-3') return { id, metadata: { acpUserId: 'nope' } };
      return null;
    };
    expect(embedGrantAllowsPath(catalog, 'POST', '/api/chat')).toBe(true);
    expect(embedGrantForbidsRequest(catalog, {
      body: { projectId: 'owned-2' },
      method: 'POST',
      originalUrl: '/api/chat',
    }, lookup)).toBe(false);
    expect(embedGrantForbidsRequest(catalog, {
      body: { projectId: 'other-3' },
      method: 'POST',
      originalUrl: '/api/chat',
    }, lookup)).toBe(true);
    expect(embedGrantForbidsRequest(catalog, {
      method: 'POST',
      originalUrl: '/api/chat',
    }, lookup)).toBe(true);
    expect(embedGrantForbidsRequest(catalog, {
      body: { projectId: 'owned-2' },
      method: 'POST',
      originalUrl: '/api/runs',
    }, lookup)).toBe(false);
  });

  it('sets Secure from req.secure or x-forwarded-proto=https', () => {
    expect(embedGrantCookieShouldBeSecure({ secure: true })).toBe(true);
    expect(embedGrantCookieShouldBeSecure({
      get: (name) => (name.toLowerCase() === 'x-forwarded-proto' ? 'https, http' : undefined),
    })).toBe(true);
    expect(embedGrantCookieShouldBeSecure({
      headers: { 'x-forwarded-proto': 'http' },
      secure: false,
    })).toBe(false);
  });

  it('stamps the verified payload and refreshes the cookie', () => {
    const minted = mintEmbedGrant(API_TOKEN, {
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    const headers = new Map<string, string>();
    const req = {
      query: { [EMBED_GRANT_QUERY]: minted.token },
    };
    const payload = applyVerifiedEmbedGrant(req, {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    }, API_TOKEN);
    expect(payload).toMatchObject({ pid: PROJECT_ID, uid: USER_ID, v: 1 });
    expect(req).toHaveProperty('embedGrant', payload);
    expect(headers.get('set-cookie')).toEqual(expect.stringContaining(`${EMBED_GRANT_COOKIE}=${minted.token}`));
  });
});
