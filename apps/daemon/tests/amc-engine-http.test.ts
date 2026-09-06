import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';
import { AMC_ENGINE_DENY_TITLE } from '../src/amc-engine/deny-page.js';
import { resetAmcLaunchGrantsForTests } from '../src/amc-engine/studio-grant.js';
import { resetAmcStudioSessionsForTests } from '../src/amc-engine/studio-session.js';

const TOKEN = 'amc-engine-test-token';
const PREV = {
  profile: process.env.OD_DEPLOYMENT_PROFILE,
  token: process.env.OD_API_TOKEN,
  secret: process.env.OD_AMC_STUDIO_SECRET,
  disable: process.env.OD_DISABLE_API_AUTH,
};

let server: Server | undefined;
let shutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let staticDir: string | undefined;

async function startEngine() {
  process.env.OD_DEPLOYMENT_PROFILE = 'amc-engine';
  process.env.OD_API_TOKEN = TOKEN;
  process.env.OD_AMC_STUDIO_SECRET = 'amc-engine-studio-secret';
  delete process.env.OD_DISABLE_API_AUTH;
  staticDir = mkdtempSync(path.join(os.tmpdir(), 'od-amc-engine-static-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><head></head><body>shell</body></html>');
  const started = (await startServer({
    port: 0,
    host: '127.0.0.1',
    returnServer: true,
    staticDir,
  })) as { url: string; server: Server; shutdown?: () => Promise<void> | void };
  server = started.server;
  shutdown = started.shutdown;
  baseUrl = started.url;
}

afterEach(async () => {
  if (shutdown) await Promise.resolve(shutdown());
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  shutdown = undefined;
  if (staticDir) rmSync(staticDir, { force: true, recursive: true });
  staticDir = undefined;
  resetAmcLaunchGrantsForTests();
  resetAmcStudioSessionsForTests();
  if (PREV.profile === undefined) delete process.env.OD_DEPLOYMENT_PROFILE;
  else process.env.OD_DEPLOYMENT_PROFILE = PREV.profile;
  if (PREV.token === undefined) delete process.env.OD_API_TOKEN;
  else process.env.OD_API_TOKEN = PREV.token;
  if (PREV.secret === undefined) delete process.env.OD_AMC_STUDIO_SECRET;
  else process.env.OD_AMC_STUDIO_SECRET = PREV.secret;
  if (PREV.disable === undefined) delete process.env.OD_DISABLE_API_AUTH;
  else process.env.OD_DISABLE_API_AUTH = PREV.disable;
});

describe('amc-engine HTTP', () => {
  beforeEach(async () => {
    await startEngine();
  });

  it('denies the public home and anonymous project list', async () => {
    const home = await fetch(`${baseUrl}/`, { headers: { accept: 'text/html' } });
    expect(home.status).toBe(404);
    expect(await home.text()).toContain(AMC_ENGINE_DENY_TITLE);

    const market = await fetch(`${baseUrl}/marketplace`, { headers: { accept: 'text/html' } });
    expect(market.status).toBe(404);

    const list = await fetch(`${baseUrl}/api/projects`);
    expect(list.status).toBe(401);
  });

  it('lets the operator Bearer create and read a project, then isolates grants', async () => {
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'amc-frun-http-1',
        name: 'Secret design',
        pendingPrompt: 'DO NOT LEAK THIS BRIEF',
        skipDiscoveryBrief: true,
        skipDefaultScenario: true,
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { project?: { id: string; pendingPrompt?: string } };
    const projectId = createdBody.project?.id || 'amc-frun-http-1';

    const mint = await fetch(`${baseUrl}/api/projects/${projectId}/embed-grants`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-42', ttlSec: 90 }),
    });
    expect(mint.status).toBe(201);
    const minted = await mint.json() as { token: string };
    expect(minted.token).toBeTruthy();

    const catalog = await fetch(`${baseUrl}/api/embed-grants`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-42', projectIds: [projectId] }),
    });
    expect(catalog.status).toBe(404);

    const launch = await fetch(
      `${baseUrl}/amc/launch?g=${encodeURIComponent(minted.token)}&next=${encodeURIComponent(`/projects/${projectId}?amcEmbed=1`)}`,
      { redirect: 'manual' },
    );
    expect(launch.status).toBe(302);
    const location = launch.headers.get('location') || '';
    expect(location).toContain(`/projects/${projectId}`);
    expect(location).toContain('amcEmbed=1');
    const cookie = launch.headers.get('set-cookie') || '';
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie).toMatch(/od_amc_studio/);

    const replay = await fetch(
      `${baseUrl}/amc/launch?g=${encodeURIComponent(minted.token)}&next=${encodeURIComponent(`/projects/${projectId}`)}`,
      { redirect: 'manual' },
    );
    expect(replay.status).toBe(404);

    const granted = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      headers: { cookie: cookie.split(';')[0] || '' },
    });
    expect(granted.status).toBe(200);
    const grantedBody = await granted.json() as { project: { pendingPrompt?: string; name?: string } };
    expect(grantedBody.project.name).toBe('Secret design');
    expect(grantedBody.project.pendingPrompt).toBeUndefined();

    const neighbor = await fetch(`${baseUrl}/api/projects/amc-frun-other`, {
      headers: { cookie: cookie.split(';')[0] || '' },
    });
    expect(neighbor.status).toBe(404);

    const listWithCookie = await fetch(`${baseUrl}/api/projects`, {
      headers: { cookie: cookie.split(';')[0] || '' },
    });
    expect(listWithCookie.status).toBe(401);

    const html = await fetch(`${baseUrl}/projects/${projectId}/conversations/c1/files/index.html`, {
      headers: {
        accept: 'text/html',
        cookie: cookie.split(';')[0] || '',
      },
    });
    expect(html.status).toBe(200);
    const htmlText = await html.text();
    expect(htmlText).toContain('__OD_AMC_ENGINE__');
    expect(htmlText).toContain('shell');

    const htmlNoCookie = await fetch(`${baseUrl}/projects/${projectId}`, {
      headers: { accept: 'text/html' },
    });
    expect(htmlNoCookie.status).toBe(404);
    expect(await htmlNoCookie.text()).toContain(AMC_ENGINE_DENY_TITLE);
  });

  it('does not treat loopback or Basic as a catalog god token', async () => {
    const basic = Buffer.from(`open-design:${TOKEN}`).toString('base64');
    const listed = await fetch(`${baseUrl}/api/projects`, {
      headers: { authorization: `Basic ${basic}` },
    });
    expect(listed.status).toBe(401);

    const loopbackList = await fetch(`${baseUrl}/api/projects`);
    expect(loopbackList.status).toBe(401);
  });
});
