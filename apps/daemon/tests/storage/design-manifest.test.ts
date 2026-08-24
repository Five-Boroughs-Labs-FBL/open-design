import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignManifestValidationError } from '@open-design/contracts';
import {
  createDesignManifestStore,
  DesignManifestNotFoundError,
  DesignManifestRevisionConflictError,
  DesignManifestWriterConflictError,
} from '../../src/storage/design-manifest.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function input(revision: number, status = 'complete') {
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
      status,
      required: true,
      states: [],
      formFactors: ['desktop'],
      latestRunId: null,
      updatedAt: null,
    }],
  };
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'od-design-manifest-'));
  roots.push(root);
  const projectDir = path.join(root, 'project-1');
  await mkdir(projectDir, { recursive: true });
  const deps = {
    projectsRoot: root,
    resolveProjectDir: (_projectsRoot: string, projectId: string) => path.join(root, projectId),
    ensureProject: async (_projectsRoot: string, projectId: string) => {
      const dir = path.join(root, projectId);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    listFiles: async (_projectsRoot: string, projectId: string) => {
      const dir = path.join(root, projectId);
      const names = await readdir(dir);
      return names.map((name) => ({ name }));
    },
  };
  const createStore = () => createDesignManifestStore(deps);
  const store = createStore();
  return { root, projectDir, store, createStore, project: { id: 'project-1' } };
}

describe('design manifest store', () => {
  it('atomically creates and reads a normalized manifest', async () => {
    const { projectDir, store, project } = await setup();
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');

    const saved = await store.put(project, { expectedRevision: 0, manifest: input(1) });
    expect(saved.coverage.ready).toBe(true);
    const stored = JSON.parse(await readFile(path.join(projectDir, 'DESIGN-MANIFEST.json'), 'utf8'));
    expect(stored.coverage).toBeUndefined();
    expect(stored.surfaces[0].filePresent).toBeUndefined();
    expect((await store.get(project)).revision).toBe(1);
  });

  it('rejects stale revisions under concurrent writes', async () => {
    const { store, project } = await setup();
    const results = await Promise.allSettled([
      store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') }),
      store.put(project, { expectedRevision: 0, manifest: input(1, 'failed') }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(DesignManifestRevisionConflictError);
  });

  it('reserves generating state for internal claims', async () => {
    const { store, project } = await setup();
    await expect(store.put(project, {
      expectedRevision: 0,
      manifest: {
        ...input(1, 'generating'),
        surfaces: [{
          ...input(1, 'generating').surfaces[0],
          latestRunId: 'forged-run',
        }],
      },
    })).rejects.toThrow('public manifest writes cannot set generating state');
  });

  it('keeps daemon authority when the public project manifest is overwritten', async () => {
    const { projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-authoritative',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });

    await writeFile(
      path.join(projectDir, 'DESIGN-MANIFEST.json'),
      JSON.stringify(input(99, 'complete')),
    );

    await expect(store.get(project)).resolves.toMatchObject({
      revision: 2,
      surfaces: [{ status: 'generating', latestRunId: 'run-authoritative' }],
    });
    await expect(
      readFile(path.join(projectDir, 'DESIGN-MANIFEST.json'), 'utf8').then(JSON.parse),
    ).resolves.toMatchObject({
      revision: 2,
      surfaces: [{ status: 'generating', latestRunId: 'run-authoritative' }],
    });
  });

  it('removes private authority when its project is deleted', async () => {
    const { projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await store.deleteProjectState(project);

    await expect(store.get(project)).rejects.toBeInstanceOf(DesignManifestNotFoundError);
  });

  it('preserves the public projection in a user-owned imported folder on deletion', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-design-manifest-imported-'));
    const importedDir = await mkdtemp(path.join(tmpdir(), 'od-design-manifest-user-folder-'));
    roots.push(root, importedDir);
    const authorityRoot = path.join(root, 'authority');
    const store = createDesignManifestStore({
      projectsRoot: root,
      authorityRoot,
      resolveProjectDir: (_projectsRoot: string, _projectId: string, metadata?: unknown) => (
        (metadata as { baseDir: string }).baseDir
      ),
      ensureProject: async (_projectsRoot: string, _projectId: string, metadata?: unknown) => (
        (metadata as { baseDir: string }).baseDir
      ),
      listFiles: async (
        _projectsRoot: string,
        _projectId: string,
        options?: { metadata?: unknown },
      ) => {
        const names = await readdir((options?.metadata as { baseDir: string }).baseDir);
        return names.map((name) => ({ name }));
      },
    });
    const project = { id: 'project-1', metadata: { baseDir: importedDir } };
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });

    await store.deleteProjectState(project);

    await expect(readFile(path.join(importedDir, 'DESIGN-MANIFEST.json'), 'utf8'))
      .resolves.toContain('open-design.design-manifest.v2');
    await expect(readFile(path.join(authorityRoot, 'project-1.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('queues project-state deletion behind reconciliation across store instances', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-design-manifest-delete-race-'));
    roots.push(root);
    const projectDir = path.join(root, 'project-1');
    const authorityRoot = path.join(root, 'authority');
    await mkdir(projectDir, { recursive: true });
    let projectPresent = true;
    let pauseInventory = false;
    let releaseInventory!: () => void;
    const inventoryReleased = new Promise<void>((resolve) => {
      releaseInventory = resolve;
    });
    let inventoryEntered!: () => void;
    const inventoryStarted = new Promise<void>((resolve) => {
      inventoryEntered = resolve;
    });
    const deps = {
      projectsRoot: root,
      authorityRoot,
      resolveProjectDir: (_projectsRoot: string, projectId: string) => path.join(root, projectId),
      ensureProject: async (_projectsRoot: string, projectId: string) => {
        const dir = path.join(root, projectId);
        await mkdir(dir, { recursive: true });
        return dir;
      },
      listFiles: async (_projectsRoot: string, projectId: string) => {
        if (pauseInventory) {
          pauseInventory = false;
          inventoryEntered();
          await inventoryReleased;
        }
        const names = await readdir(path.join(root, projectId));
        return names.map((name) => ({ name }));
      },
      projectExists: () => projectPresent,
    };
    const writerStore = createDesignManifestStore(deps);
    const deletionStore = createDesignManifestStore(deps);
    const project = { id: 'project-1' };
    await writerStore.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await writerStore.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-racing-delete',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');

    pauseInventory = true;
    const finishing = writerStore.finishClaim(project, {
      surfaceIds: ['dashboard'],
      completedSurfaceIds: ['dashboard'],
      runId: 'run-racing-delete',
      updatedAt: '2026-08-22T01:01:00.000Z',
    });
    await inventoryStarted;
    projectPresent = false;
    const deleting = deletionStore.deleteProjectState(project);
    releaseInventory();
    await finishing;
    await deleting;

    await expect(readFile(path.join(projectDir, 'DESIGN-MANIFEST.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(authorityRoot, 'project-1.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(writerStore.finishClaim(project, {
      surfaceIds: ['dashboard'],
      completedSurfaceIds: ['dashboard'],
      runId: 'run-racing-delete',
      updatedAt: '2026-08-22T01:02:00.000Z',
    })).rejects.toBeInstanceOf(DesignManifestNotFoundError);
    await expect(readFile(path.join(projectDir, 'DESIGN-MANIFEST.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('re-derives coverage after a committed surface file is deleted', async () => {
    const { projectDir, store, project } = await setup();
    const htmlPath = path.join(projectDir, 'index.html');
    await writeFile(htmlPath, '<!doctype html>');
    await store.put(project, { expectedRevision: 0, manifest: input(1) });
    await rm(htmlPath);

    const current = await store.get(project);
    expect(current.surfaces[0]?.filePresent).toBe(false);
    expect(current.coverage).toMatchObject({ complete: 0, pending: 1, ready: false });
  });

  it('does not promote a copied or model-authored public v2 manifest into authority', async () => {
    const { root, projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    const duplicateDir = path.join(root, 'project-2');
    await mkdir(duplicateDir);
    await copyFile(
      path.join(projectDir, 'DESIGN-MANIFEST.json'),
      path.join(duplicateDir, 'DESIGN-MANIFEST.json'),
    );

    await expect(store.get({ id: 'project-2' }))
      .rejects.toBeInstanceOf(DesignManifestNotFoundError);
  });

  it('allows a sanctioned duplicate to seed fresh destination authority', async () => {
    const { root, projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    const source = await store.get(project);
    const duplicateDir = path.join(root, 'project-2');
    await mkdir(duplicateDir);
    await copyFile(
      path.join(projectDir, 'DESIGN-MANIFEST.json'),
      path.join(duplicateDir, 'DESIGN-MANIFEST.json'),
    );

    const duplicate = await store.put({ id: 'project-2' }, {
      expectedRevision: 0,
      manifest: {
        schema: source.schema,
        revision: 1,
        projectId: 'project-2',
        entrySurfaceId: source.entrySurfaceId,
        scope: source.scope,
        directionStatus: source.directionStatus,
        surfaces: source.surfaces.map(({ filePresent: _filePresent, ...surface }) => ({
          ...surface,
          latestRunId: null,
          updatedAt: null,
        })),
      },
    });
    expect(duplicate).toMatchObject({ projectId: 'project-2', revision: 1 });
  });

  it('treats the export-only v1 manifest as absent durable state', async () => {
    const { projectDir, store, project } = await setup();
    await writeFile(
      path.join(projectDir, 'DESIGN-MANIFEST.json'),
      JSON.stringify({ schema: 'open-design.design-manifest.v1', files: ['index.html'] }),
    );

    await expect(store.get(project)).rejects.toBeInstanceOf(DesignManifestNotFoundError);
  });

  it('claims, excludes concurrent writers, and atomically completes committed files', async () => {
    const { projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });

    const claimed = await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-1',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });
    expect(claimed).toMatchObject({ revision: 2, surfaces: [{ status: 'generating', latestRunId: 'run-1' }] });
    await expect(store.claim(project, {
      expectedRevision: 2,
      surfaceIds: ['dashboard'],
      runId: 'run-2',
      updatedAt: '2026-08-22T01:01:00.000Z',
    })).rejects.toBeInstanceOf(DesignManifestWriterConflictError);
    await expect(store.put(project, {
      expectedRevision: 2,
      manifest: input(3, 'queued'),
    })).rejects.toBeInstanceOf(DesignManifestWriterConflictError);

    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');
    const finished = await store.finishClaim(project, {
      surfaceIds: ['dashboard'],
      completedSurfaceIds: ['dashboard'],
      runId: 'run-1',
      updatedAt: '2026-08-22T01:02:00.000Z',
    });
    expect(finished).toMatchObject({ revision: 3, surfaces: [{ status: 'complete', filePresent: true }] });
  });

  it('recovers a stale generating claim to failed after restart', async () => {
    const { store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-gone',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });

    const recovered = await store.recoverStaleClaims(project, {
      runState: () => null,
      updatedAt: '2026-08-22T01:03:00.000Z',
    });
    expect(recovered).toMatchObject({ revision: 3, surfaces: [{ status: 'failed' }] });
  });

  it('recovers a terminal successful claim as complete when durable paths prove the file', async () => {
    const { projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-terminal',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');

    const recovered = await store.recoverStaleClaims(project, {
      runState: () => ({
        active: false,
        succeeded: true,
        exactOutputValidated: true,
        artifactPaths: ['index.html'],
      }),
      updatedAt: '2026-08-22T01:03:00.000Z',
    });
    expect(recovered).toMatchObject({
      revision: 3,
      surfaces: [{ status: 'complete', filePresent: true }],
    });
  });

  it('completes a touched present file even when run-level exactOutputValidated is false', async () => {
    const { projectDir, store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-unvalidated',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');

    const recovered = await store.recoverStaleClaims(project, {
      runState: () => ({
        active: false,
        succeeded: true,
        exactOutputValidated: false,
        artifactPaths: ['index.html'],
      }),
      updatedAt: '2026-08-22T01:03:00.000Z',
    });
    expect(recovered).toMatchObject({
      revision: 3,
      surfaces: [{ status: 'complete', filePresent: true }],
    });
  });

  it('completes only the surfaces whose files are present after a partial run', async () => {
    const { projectDir, store, project } = await setup();
    const surfaces = [
      {
        id: 'dashboard',
        title: 'Dashboard',
        file: 'index.html',
        status: 'queued',
        required: true,
        states: [],
        formFactors: ['desktop'],
        latestRunId: null,
        updatedAt: null,
      },
      {
        id: 'billing',
        title: 'Billing',
        file: 'billing.html',
        status: 'queued',
        required: true,
        states: [],
        formFactors: ['desktop'],
        latestRunId: null,
        updatedAt: null,
      },
    ];
    await store.put(project, {
      expectedRevision: 0,
      manifest: { ...input(1, 'queued'), entrySurfaceId: 'dashboard', surfaces },
    });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard', 'billing'],
      runId: 'run-partial',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html>');

    const recovered = await store.recoverStaleClaims(project, {
      runState: () => ({
        active: false,
        succeeded: false,
        exactOutputValidated: false,
        artifactPaths: ['index.html'],
      }),
      updatedAt: '2026-08-22T01:03:00.000Z',
    });
    expect(recovered.surfaces.map((surface) => [surface.id, surface.status])).toEqual([
      ['dashboard', 'complete'],
      ['billing', 'failed'],
    ]);
  });

  it('claims ten surfaces in one writer lock', async () => {
    const { store, project } = await setup();
    const surfaces = Array.from({ length: 10 }, (_, index) => ({
      id: index === 0 ? 'dashboard' : `screen-${index + 1}`,
      title: index === 0 ? 'Dashboard' : `Screen ${index + 1}`,
      file: index === 0 ? 'index.html' : `screen-${index + 1}.html`,
      status: 'queued',
      required: true,
      states: [],
      formFactors: ['desktop'],
      latestRunId: null,
      updatedAt: null,
    }));
    await store.put(project, {
      expectedRevision: 0,
      manifest: { ...input(1, 'queued'), surfaces },
    });
    const claimed = await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: surfaces.map((surface) => surface.id),
      runId: 'run-ten',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });
    expect(claimed.surfaces.every((surface) => surface.status === 'generating')).toBe(true);
    await expect(store.claim(project, {
      expectedRevision: 2,
      surfaceIds: Array.from({ length: 61 }, (_, index) => `s-${index + 1}`),
      runId: 'run-too-many',
      updatedAt: '2026-08-22T01:01:00.000Z',
    })).rejects.toBeInstanceOf(DesignManifestValidationError);
  });

  it('fails a stale claim whose file is missing even if the run succeeded', async () => {
    const { store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'queued') });
    await store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-missing-file',
      updatedAt: '2026-08-22T01:00:00.000Z',
    });

    const recovered = await store.recoverStaleClaims(project, {
      runState: () => ({
        active: false,
        succeeded: true,
        exactOutputValidated: true,
        artifactPaths: ['index.html'],
      }),
      updatedAt: '2026-08-22T01:03:00.000Z',
    });
    expect(recovered).toMatchObject({
      revision: 3,
      surfaces: [{ status: 'failed', filePresent: false }],
    });
  });

  it('allows regeneration when a complete surface file has gone missing', async () => {
    const { store, project } = await setup();
    await store.put(project, { expectedRevision: 0, manifest: input(1, 'complete') });
    await expect(store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-repair',
      updatedAt: '2026-08-22T01:00:00.000Z',
    })).resolves.toMatchObject({ surfaces: [{ status: 'generating' }] });
  });

  it('requires a locked direction before claiming generation', async () => {
    const { store, project } = await setup();
    await store.put(project, {
      expectedRevision: 0,
      manifest: { ...input(1, 'queued'), directionStatus: 'draft' },
    });
    await expect(store.claim(project, {
      expectedRevision: 1,
      surfaceIds: ['dashboard'],
      runId: 'run-1',
      updatedAt: '2026-08-22T01:00:00.000Z',
    })).rejects.toThrow('directionStatus must be locked');
  });
});
