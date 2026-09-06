import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EMBED_GRANT_COOKIE } from '../src/embed-grants.js';
import { startServer } from '../src/server.js';

const TOKEN = 'acp-catalog-integration-token';
const PREVIOUS_TOKEN = process.env.OD_API_TOKEN;
const PREVIOUS_DISABLE = process.env.OD_DISABLE_API_AUTH;
const PREVIOUS_SSO = process.env.OD_ACP_SSO_URL;
const AUTHORIZATION = `Bearer ${TOKEN}`;

type JsonResponse = {
  body: unknown;
  setCookie: string | null;
  status: number;
  text: string;
};

let server: Server | undefined;
let shutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let staticDir: string | undefined;

function makeConnectionsAppearNonLoopback(target: Server): void {
  target.prependListener('connection', (socket) => {
    Object.defineProperty(socket, 'remoteAddress', {
      configurable: true,
      value: '172.18.0.1',
    });
  });
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const error = (body as { error?: { code?: unknown } }).error;
  return error && typeof error.code === 'string' ? error.code : undefined;
}

function projectIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const projects = (body as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return [];
  return projects
    .map((project) => (project && typeof project === 'object' ? (project as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string');
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<JsonResponse> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    body,
    setCookie: resp.headers.get('set-cookie'),
    status: resp.status,
    text,
  };
}

async function createProject(
  name: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const id = `proj_${randomUUID()}`;
  const resp = await jsonRequest(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      authorization: AUTHORIZATION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id,
      name,
      metadata,
      skipDiscoveryBrief: true,
      skipDefaultScenario: true,
    }),
  });
  expect(resp.status).toBe(200);
  return id;
}

async function mintCatalog(userId: string, projectIds: string[] = []): Promise<string> {
  const resp = await jsonRequest(`${baseUrl}/api/embed-grants`, {
    method: 'POST',
    headers: {
      authorization: AUTHORIZATION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId, projectIds }),
  });
  expect(resp.status).toBe(200);
  const token = (resp.body as { token?: string }).token;
  expect(typeof token).toBe('string');
  return token!;
}

describe('ACP catalog grant integration', () => {
  beforeEach(async () => {
    delete process.env.OD_DISABLE_API_AUTH;
    process.env.OD_API_TOKEN = TOKEN;
    process.env.OD_ACP_SSO_URL = 'https://acp.test/open-design/sso';
    staticDir = mkdtempSync(path.join(os.tmpdir(), 'od-acp-catalog-static-'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><div>studio embed shell</div>');
    const started = (await startServer({
      port: 0,
      host: '127.0.0.1',
      returnServer: true,
      staticDir,
    })) as { url: string; server: Server; shutdown?: () => Promise<void> | void };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
    makeConnectionsAppearNonLoopback(server);
  });

  afterEach(async () => {
    if (shutdown) await Promise.resolve(shutdown());
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    shutdown = undefined;
    if (staticDir) rmSync(staticDir, { force: true, recursive: true });
    staticDir = undefined;
    if (PREVIOUS_TOKEN === undefined) delete process.env.OD_API_TOKEN;
    else process.env.OD_API_TOKEN = PREVIOUS_TOKEN;
    if (PREVIOUS_DISABLE === undefined) delete process.env.OD_DISABLE_API_AUTH;
    else process.env.OD_DISABLE_API_AUTH = PREVIOUS_DISABLE;
    if (PREVIOUS_SSO === undefined) delete process.env.OD_ACP_SSO_URL;
    else process.env.OD_ACP_SSO_URL = PREVIOUS_SSO;
  });

  it('isolates alice and bob catalogs, including legacy pids and new creates', async () => {
    const aliceLegacy = await createProject('Alice legacy', { kind: 'prototype' });
    const aliceOwned = await createProject('Alice owned', {
      kind: 'prototype',
      acpUserId: 'user-alice',
    });
    const bobOwned = await createProject('Bob owned', {
      kind: 'prototype',
      acpUserId: 'user-bob',
    });
    const stranger = await createProject('Stranger', { kind: 'prototype', acpUserId: 'user-carol' });

    const aliceToken = await mintCatalog('user-alice', [aliceLegacy]);
    const bobToken = await mintCatalog('user-bob', []);
    const aliceCookie = { cookie: `${EMBED_GRANT_COOKIE}=${aliceToken}` };
    const bobCookie = { cookie: `${EMBED_GRANT_COOKIE}=${bobToken}` };

    const aliceList = await jsonRequest(`${baseUrl}/api/projects`, { headers: aliceCookie });
    expect(aliceList.status).toBe(200);
    expect((await jsonRequest(`${baseUrl}/api/skills`, { headers: aliceCookie })).status).not.toBe(403);
    expect((await jsonRequest(`${baseUrl}/api/design-templates`, { headers: aliceCookie })).status).not.toBe(403);
    expect((await jsonRequest(`${baseUrl}/api/design-systems`, { headers: aliceCookie })).status).not.toBe(403);
    expect(projectIds(aliceList.body).sort()).toEqual([aliceLegacy, aliceOwned].sort());

    const bobList = await jsonRequest(`${baseUrl}/api/projects`, { headers: bobCookie });
    expect(bobList.status).toBe(200);
    expect(projectIds(bobList.body)).toEqual([bobOwned]);

    expect((await jsonRequest(`${baseUrl}/api/projects/${aliceOwned}`, { headers: aliceCookie })).status).toBe(200);
    expect((await jsonRequest(`${baseUrl}/api/projects/${aliceLegacy}`, { headers: aliceCookie })).status).toBe(200);
    expect(errorCode((await jsonRequest(`${baseUrl}/api/projects/${bobOwned}`, { headers: aliceCookie })).body)).toBe('EMBED_GRANT_SCOPE');
    expect((await jsonRequest(`${baseUrl}/api/projects/${bobOwned}`, { headers: aliceCookie })).status).toBe(403);
    expect((await jsonRequest(`${baseUrl}/api/projects/${stranger}`, { headers: aliceCookie })).status).toBe(403);
    expect((await jsonRequest(`${baseUrl}/api/projects/${aliceOwned}`, { headers: bobCookie })).status).toBe(403);

    const created = await jsonRequest(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        ...aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: `proj_${randomUUID()}`,
        name: 'Alice from catalog',
        metadata: { kind: 'prototype' },
        skipDiscoveryBrief: true,
        skipDefaultScenario: true,
      }),
    });
    expect(created.status).toBe(200);
    const createdId = (created.body as { project?: { id?: string }; id?: string }).project?.id
      ?? (created.body as { id?: string }).id;
    expect(typeof createdId).toBe('string');

    const aliceListAfter = await jsonRequest(`${baseUrl}/api/projects`, { headers: aliceCookie });
    expect(projectIds(aliceListAfter.body)).toEqual(expect.arrayContaining([aliceLegacy, aliceOwned, createdId!]));
    expect((await jsonRequest(`${baseUrl}/api/projects/${createdId}`, { headers: bobCookie })).status).toBe(403);

    const fileWrite = await jsonRequest(`${baseUrl}/api/projects/${createdId}/files`, {
      method: 'POST',
      headers: {
        ...aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'notes.md', content: 'alice-only' }),
    });
    expect([200, 201]).toContain(fileWrite.status);
    expect((await jsonRequest(`${baseUrl}/api/projects/${createdId}/files`, { headers: aliceCookie })).status).toBe(200);
    expect((await jsonRequest(`${baseUrl}/api/projects/${createdId}/files`, { headers: bobCookie })).status).toBe(403);

    const bobFile = await jsonRequest(`${baseUrl}/api/projects/${createdId}/files`, {
      method: 'POST',
      headers: {
        ...bobCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'steal.md', content: 'nope' }),
    });
    expect(bobFile.status).toBe(403);

    const bobRun = await jsonRequest(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        ...bobCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectId: createdId }),
    });
    expect(bobRun.status).toBe(403);
    expect(errorCode(bobRun.body)).toBe('EMBED_GRANT_SCOPE');

    const aliceChat = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        ...aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'not-a-real-agent',
        message: 'hello',
        projectId: createdId,
      }),
    });
    // Grant check is middleware: 403 EMBED_GRANT_SCOPE is the bug. Any other
    // outcome (validation error, unknown agent) means the catalog user may chat
    // on their own project. Cancel the body so a 200 SSE stream cannot hang.
    expect(aliceChat.status).not.toBe(403);
    if (aliceChat.status !== 200) {
      const aliceChatBody = await aliceChat.json().catch(() => null);
      expect(errorCode(aliceChatBody)).not.toBe('EMBED_GRANT_SCOPE');
    } else {
      await aliceChat.body?.cancel();
    }

    const bobChat = await jsonRequest(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        ...bobCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'not-a-real-agent',
        message: 'hello',
        projectId: createdId,
      }),
    });
    expect(bobChat.status).toBe(403);
    expect(errorCode(bobChat.body)).toBe('EMBED_GRANT_SCOPE');
  });

  it('keeps APIs locked without a grant while serving the SSO shell and public runtime', async () => {
    const spa = await fetch(`${baseUrl}/`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    expect(spa.status).toBe(302);
    expect(spa.headers.get('location') ?? '').toContain('https://acp.test/open-design/sso?');

    const runtime = await jsonRequest(`${baseUrl}/api/public-runtime`);
    expect(runtime.status).toBe(200);
    expect(runtime.body).toEqual({ acpSsoUrl: 'https://acp.test/open-design/sso' });

    const projects = await jsonRequest(`${baseUrl}/api/projects`);
    expect(projects.status).toBe(401);

    const forged = await jsonRequest(`${baseUrl}/api/projects`, {
      headers: { cookie: `${EMBED_GRANT_COOKIE}=not-a-real-grant` },
    });
    expect(forged.status).toBe(401);
  });

  it('does not let a catalog grant mint another grant', async () => {
    const owned = await createProject('Mint lock', { kind: 'prototype', acpUserId: 'user-dave' });
    const token = await mintCatalog('user-dave', []);
    const remint = await jsonRequest(`${baseUrl}/api/embed-grants`, {
      method: 'POST',
      headers: {
        cookie: `${EMBED_GRANT_COOKIE}=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-dave', projectIds: [owned] }),
    });
    expect([401, 403]).toContain(remint.status);
  });
});
