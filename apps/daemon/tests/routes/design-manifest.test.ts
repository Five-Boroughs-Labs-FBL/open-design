import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import type http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDesignManifestRoutes } from '../../src/routes/project/design-manifest.js';
import { createDesignManifestStore } from '../../src/storage/design-manifest.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function manifest(revision: number) {
  return {
    schema: 'open-design.design-manifest.v2',
    revision,
    projectId: 'project-1',
    entrySurfaceId: 'dashboard',
    scope: {
      schema: 'amc.design-scope.v1',
      scopeId: 'scope-1',
      revision: 1,
      intentDigest: 'sha256:abc',
    },
    directionStatus: 'locked',
    surfaces: [{
      id: 'dashboard',
      title: 'Dashboard',
      file: 'index.html',
      status: 'complete',
      required: true,
      states: [],
      formFactors: ['desktop'],
      latestRunId: null,
      updatedAt: null,
    }],
  };
}

async function setup(options: {
  recoverStaleClaims?: Parameters<typeof registerDesignManifestRoutes>[1]['recoverStaleClaims'];
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'od-design-manifest-route-'));
  const projectDir = path.join(root, 'project-1');
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');
  const store = createDesignManifestStore({
    projectsRoot: root,
    resolveProjectDir: (_root, projectId) => path.join(root, projectId),
    ensureProject: async (_root, projectId) => {
      const dir = path.join(root, projectId);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    listFiles: async (_root, projectId) =>
      (await readdir(path.join(root, projectId))).map((name) => ({ name })),
  });
  const invalidations: string[] = [];
  const app = express();
  app.use(express.json());
  registerDesignManifestRoutes(app, {
    getProject: (id) => id === 'project-1' ? { id } : null,
    authorizeProjectRequest: async (req, res) => {
      if (req.get('authorization') === 'Bearer test-token') return true;
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'unauthorized' } });
      return false;
    },
    sendApiError: (res, status, code, message, details) =>
      res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } }),
    store,
    ...(options.recoverStaleClaims ? { recoverStaleClaims: options.recoverStaleClaims } : {}),
    emitInvalidation: (projectId) => invalidations.push(projectId),
  });
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    invalidations,
    store,
    project: { id: 'project-1' },
  };
}

describe('project design manifest routes', () => {
  it('requires project authorization for reads and writes', async () => {
    const { baseUrl } = await setup();
    expect((await fetch(`${baseUrl}/api/projects/project-1/design-manifest`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/projects/project-1/design-manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, manifest: manifest(1) }),
    })).status).toBe(401);
  });

  it('creates and gets the normalized manifest and emits an invalidation', async () => {
    const { baseUrl, invalidations } = await setup();
    const put = await fetch(`${baseUrl}/api/projects/project-1/design-manifest`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expectedRevision: 0,
        manifest: { ...manifest(1), coverage: { ready: false } },
      }),
    });
    expect(put.status).toBe(200);
    const putBody = await put.json() as {
      manifest: { coverage: { ready: boolean } };
    };
    expect(putBody.manifest.coverage.ready).toBe(true);
    expect(invalidations).toEqual(['project-1']);

    const get = await fetch(`${baseUrl}/api/projects/project-1/design-manifest`, {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(get.status).toBe(200);
    expect(get.headers.get('cache-control')).toBe('no-store');
    const getBody = await get.json() as { manifest: { revision: number } };
    expect(getBody.manifest.revision).toBe(1);
  });

  it('returns a typed conflict for a stale optimistic revision', async () => {
    const { baseUrl } = await setup();
    const request = (expectedRevision: number) => fetch(
      `${baseUrl}/api/projects/project-1/design-manifest`,
      {
        method: 'PUT',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ expectedRevision, manifest: manifest(1) }),
      },
    );
    expect((await request(0)).status).toBe(200);
    const stale = await request(0);
    expect(stale.status).toBe(409);
    const staleBody = await stale.json() as { error: unknown };
    expect(staleBody.error).toMatchObject({
      code: 'DESIGN_MANIFEST_REVISION_CONFLICT',
      details: { expectedRevision: 0, currentRevision: 1 },
    });
  });

  it('returns a typed writer conflict while an internal claim is active', async () => {
    const { baseUrl, store, project } = await setup();
    const headers = {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    };
    expect((await fetch(`${baseUrl}/api/projects/project-1/design-manifest`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        manifest: { ...manifest(1), surfaces: [{ ...manifest(1).surfaces[0], status: 'queued' }] },
      }),
    })).status).toBe(200);
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-active',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });

    const blocked = await fetch(`${baseUrl}/api/projects/project-1/design-manifest`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ expectedRevision: 2, manifest: manifest(3) }),
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      error: {
        code: 'DESIGN_MANIFEST_WRITER_CONFLICT',
        details: { surfaceIds: ['dashboard'] },
      },
    });
  });

  it('reconciles stale claims before GET returns manifest state', async () => {
    let recoverCalls = 0;
    let routeStore: ReturnType<typeof createDesignManifestStore> | null = null;
    const setupResult = await setup({
      recoverStaleClaims: async (project) => {
        recoverCalls += 1;
        await routeStore!.recoverStaleClaims(project, {
          runState: () => ({
            active: false,
            succeeded: false,
            exactOutputValidated: false,
          }),
          updatedAt: '2026-08-22T02:00:00.000Z',
        });
      },
    });
    routeStore = setupResult.store;
    const { baseUrl, store, project } = setupResult;
    await store.put(project, {
      expectedRevision: 0,
      manifest: { ...manifest(1), surfaces: [{ ...manifest(1).surfaces[0], status: 'queued' }] },
    });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-interrupted',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });

    const response = await fetch(`${baseUrl}/api/projects/project-1/design-manifest`, {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      manifest: {
        revision: 3,
        surfaces: [{ id: 'dashboard', status: 'failed' }],
      },
    });
    expect(recoverCalls).toBe(1);
  });
});
