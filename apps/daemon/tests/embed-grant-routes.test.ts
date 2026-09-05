import { execFile } from 'node:child_process';
import http from 'node:http';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mintEmbedGrant, verifyEmbedGrant, type EmbedGrantPayload } from '../src/embed-grants.js';
import { sendApiError } from '../src/http/api-errors.js';
import { registerEmbedGrantRoutes } from '../src/routes/embed-grants.js';
import { startServer } from '../src/server.js';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

const API_TOKEN = 'embed-grant-route-test-token';
const PREVIOUS_TOKEN = process.env.OD_API_TOKEN;

type Started = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

function makeConnectionsAppearNonLoopback(target: Server): void {
  target.prependListener('connection', (socket) => {
    Object.defineProperty(socket, 'remoteAddress', {
      configurable: true,
      value: '172.18.0.1',
    });
  });
}

function restoreApiToken(): void {
  if (PREVIOUS_TOKEN === undefined) delete process.env.OD_API_TOKEN;
  else process.env.OD_API_TOKEN = PREVIOUS_TOKEN;
}

async function stopStarted(started: Started | undefined): Promise<void> {
  if (!started) return;
  await Promise.resolve(started.shutdown?.());
  await new Promise<void>((resolve) => started.server.close(() => resolve()));
}

async function jsonRequest(
  url: string,
  init: RequestInit = {},
): Promise<{ body: unknown; status: number }> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { body, status: resp.status };
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const error = (body as { error?: { code?: unknown } }).error;
  return error && typeof error.code === 'string' ? error.code : undefined;
}

async function createProject(baseUrl: string): Promise<string> {
  const projectId = `proj_${randomUUID()}`;
  const resp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'Embed grant mint',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
      skipDefaultScenario: true,
    }),
  });
  expect(resp.status).toBe(200);
  return projectId;
}

function mintUrl(baseUrl: string, projectId: string): string {
  return `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/embed-grants`;
}

async function listenApp(app: express.Express): Promise<{ baseUrl: string; server: Server }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('server did not bind');
  return { baseUrl: `http://127.0.0.1:${addr.port}`, server };
}

interface CapturedRequest {
  body: string;
  method: string;
  url: string;
}

async function startStubServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requests: CapturedRequest[];
  setResponder: (fn: (req: CapturedRequest) => { body: unknown; status: number }) => void;
}> {
  const requests: CapturedRequest[] = [];
  let responder: ((req: CapturedRequest) => { body: unknown; status: number }) | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const captured: CapturedRequest = {
        body: Buffer.concat(chunks).toString('utf8'),
        method: req.method ?? '',
        url: req.url ?? '',
      };
      requests.push(captured);
      const response = responder?.(captured) ?? { status: 200, body: { ok: true } };
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    setResponder: (fn) => {
      responder = fn;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function runCli(
  args: string[],
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 20_000,
    });
    return { code: 0, stderr, stdout };
  } catch (err) {
    const failed = err as { code?: number | null; stderr?: string; stdout?: string };
    return {
      code: failed.code ?? 1,
      stderr: failed.stderr ?? '',
      stdout: failed.stdout ?? '',
    };
  }
}

describe('POST /api/projects/:id/embed-grants (non-loopback)', () => {
  let started: Started | undefined;

  beforeAll(async () => {
    process.env.OD_API_TOKEN = API_TOKEN;
    started = (await startServer({
      host: '127.0.0.1',
      port: 0,
      returnServer: true,
    })) as Started;
    makeConnectionsAppearNonLoopback(started.server);
  });

  afterAll(async () => {
    await stopStarted(started);
    restoreApiToken();
  });

  it('returns 401 without Bearer', async () => {
    const resp = await jsonRequest(mintUrl(started!.url, 'missing-project'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1' }),
    });
    expect(resp.status).toBe(401);
  });
});

describe('POST /api/projects/:id/embed-grants (loopback)', () => {
  let started: Started | undefined;

  beforeAll(async () => {
    process.env.OD_API_TOKEN = API_TOKEN;
    started = (await startServer({
      host: '127.0.0.1',
      port: 0,
      returnServer: true,
    })) as Started;
  });

  afterAll(async () => {
    await stopStarted(started);
    restoreApiToken();
  });

  it('returns 404 when the project is missing', async () => {
    const resp = await jsonRequest(mintUrl(started!.url, 'missing-project'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'u1' }),
    });
    expect(resp.status).toBe(404);
    expect(errorCode(resp.body)).toBe('PROJECT_NOT_FOUND');
  });

  it('mints on loopback without Bearer when OD_API_TOKEN is set', async () => {
    const projectId = await createProject(started!.url);
    const resp = await jsonRequest(mintUrl(started!.url, projectId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'amc-user-loopback' }),
    });
    expect(resp.status).toBe(200);
    const body = resp.body as { token?: string };
    expect(verifyEmbedGrant(API_TOKEN, body.token ?? '')).toMatchObject({
      pid: projectId,
      uid: 'amc-user-loopback',
      v: 1,
    });
  });

  it('returns 200 with a verifiable grant for an existing project', async () => {
    const projectId = await createProject(started!.url);
    const resp = await jsonRequest(mintUrl(started!.url, projectId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'amc-user-1' }),
    });
    expect(resp.status).toBe(200);
    const body = resp.body as {
      expiresAt?: string;
      projectId?: string;
      token?: string;
      userId?: string;
    };
    expect(body.projectId).toBe(projectId);
    expect(body.userId).toBe('amc-user-1');
    expect(typeof body.token).toBe('string');
    expect(body.token!.length).toBeGreaterThan(0);
    expect(body.expiresAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    const payload = verifyEmbedGrant(API_TOKEN, body.token!);
    expect(payload).toMatchObject({ pid: projectId, uid: 'amc-user-1', v: 1 });
    expect(payload?.exp).toBe(Math.floor(Date.parse(body.expiresAt!) / 1000));
  });

  it('returns 401 when Bearer is a grant token rather than the API token', async () => {
    const projectId = await createProject(started!.url);
    const grant = mintEmbedGrant(API_TOKEN, {
      projectId,
      userId: 'amc-user-1',
    });
    const resp = await jsonRequest(mintUrl(started!.url, projectId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${grant.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'amc-user-1' }),
    });
    expect(resp.status).toBe(401);
  });

  it('returns 400 when userId is missing', async () => {
    const projectId = await createProject(started!.url);
    const resp = await jsonRequest(mintUrl(started!.url, projectId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
    expect(errorCode(resp.body)).toBe('BAD_REQUEST');
  });
});

describe('registerEmbedGrantRoutes grant principal', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    restoreApiToken();
  });

  it('returns 403 EMBED_GRANT_SCOPE when req.embedGrant is set', async () => {
    process.env.OD_API_TOKEN = API_TOKEN;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { embedGrant?: EmbedGrantPayload }).embedGrant = {
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        pid: 'proj_grant',
        uid: 'amc-user-1',
        v: 1,
      };
      next();
    });
    registerEmbedGrantRoutes(app, {
      getProject: (projectId) => ({ id: projectId }),
      sendApiError,
    });
    const { baseUrl, server } = await listenApp(app);
    servers.push(server);

    const resp = await jsonRequest(mintUrl(baseUrl, 'proj_grant'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'amc-user-1' }),
    });
    expect(resp.status).toBe(403);
    expect(errorCode(resp.body)).toBe('EMBED_GRANT_SCOPE');
  });
});

describe('od project embed-grant CLI', () => {
  let stub: Awaited<ReturnType<typeof startStubServer>>;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
  });

  it('prints token, projectId, and expiresAt as JSON', async () => {
    const minted = {
      expiresAt: '2026-01-16T00:00:00.000Z',
      projectId: 'proj_cli',
      token: 'grant.token',
      userId: 'u1',
    };
    stub.setResponder(() => ({ status: 200, body: minted }));

    const result = await runCli([
      'project',
      'embed-grant',
      'proj_cli',
      '--user-id',
      'u1',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe('POST');
    expect(stub.requests[0]?.url).toBe('/api/projects/proj_cli/embed-grants');
    expect(JSON.parse(stub.requests[0]?.body ?? '{}')).toEqual({ userId: 'u1' });

    const printed = JSON.parse(result.stdout) as {
      expiresAt?: string;
      projectId?: string;
      token?: string;
    };
    expect(printed).toMatchObject({
      expiresAt: minted.expiresAt,
      projectId: minted.projectId,
      token: minted.token,
    });
  });

  it('mints an ACP catalog grant', async () => {
    const minted = {
      expiresAt: '2026-01-16T00:00:00.000Z',
      projectId: '*',
      projectIds: ['legacy-1'],
      token: 'catalog.token',
      userId: 'acp-user',
    };
    stub.setResponder(() => ({ status: 200, body: minted }));

    const result = await runCli([
      'project',
      'embed-grant',
      '--catalog',
      '--user-id',
      'acp-user',
      '--project-ids',
      'legacy-1',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe('POST');
    expect(stub.requests[0]?.url).toBe('/api/embed-grants');
    expect(JSON.parse(stub.requests[0]?.body ?? '{}')).toEqual({
      projectIds: ['legacy-1'],
      userId: 'acp-user',
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      projectId: '*',
      token: minted.token,
      userId: 'acp-user',
    });
  });
});
