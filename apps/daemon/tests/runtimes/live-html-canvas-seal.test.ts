import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createLiveHtmlCanvasWriter } from '../../src/runtimes/live-html-canvas.js';
import {
  LIVE_HTML_CANVAS_NAME,
  persistLiveHtmlCanvas,
  restoreLiveHtmlCanvasIfMixed,
  sealLiveHtmlCanvasStatus,
} from '../../src/runtimes/plain-stream.js';
import { readProjectFile, writeProjectFile } from '../../src/projects.js';
import { CLEAN_LOGIN_HTML, LIVE_PRIMARY_LEAK_HTML } from '../artifacts/html-document.fixtures.js';

const PROJECT_ID = 'project-1';
const MANIFEST_NAME = `${LIVE_HTML_CANVAS_NAME}.artifact.json`;

async function withProject(
  run: (ctx: { projectsRoot: string; projectDir: string }) => Promise<void>,
): Promise<void> {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-seal-'));
  try {
    const projectDir = path.join(projectsRoot, PROJECT_ID);
    await mkdir(projectDir, { recursive: true });
    await run({ projectsRoot, projectDir });
  } finally {
    // Windows can still hold a handle from the write chain for a tick.
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
}

async function readManifest(projectDir: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path.join(projectDir, MANIFEST_NAME), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The writer persists on an internal promise chain, so a draft lands a tick or
 * more after `note`. Poll rather than counting ticks -- a fixed tick count is
 * a Windows flake waiting to happen.
 */
async function waitForManifest(projectDir: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 100; i += 1) {
    const manifest = await readManifest(projectDir);
    if (manifest) return manifest;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  return null;
}

describe('sealing the live HTML canvas status', () => {
  it('leaves a first-run canvas complete when the stream ends mixed', async () => {
    // The 2026-08-26 rickshaw specimen. No previous file exists, so restore has
    // no snapshot and no-ops; the mixed dump clears `pending`, so flush has no
    // body to persist. Without a seal the good draft on disk keeps `streaming`
    // and the Design Files tile spins for good.
    await withProject(async ({ projectsRoot, projectDir }) => {
      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        previousCleanContent: null,
        persist: (artifact, status) => persistLiveHtmlCanvas({
          projectsRoot,
          projectId: PROJECT_ID,
          artifact,
          status,
          writeProjectFile: writeProjectFile as any,
        }),
        sealStatus: (status) => sealLiveHtmlCanvasStatus({
          projectsRoot,
          projectId: PROJECT_ID,
          name: LIVE_HTML_CANVAS_NAME,
          status,
          readProjectFile: readProjectFile as any,
        }),
      });

      writer.note(CLEAN_LOGIN_HTML);
      expect((await waitForManifest(projectDir))?.status).toBe('streaming');

      writer.note(LIVE_PRIMARY_LEAK_HTML);
      await expect(writer.flush('complete')).resolves.toBeUndefined();

      const body = await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toBe(CLEAN_LOGIN_HTML);
      expect(body).not.toContain('fonts.googleapis.');
      expect((await readManifest(projectDir))?.status).toBe('complete');
    });
  });

  it('refuses to seal a body that is not one HTML document', async () => {
    await withProject(async ({ projectsRoot, projectDir }) => {
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), LIVE_PRIMARY_LEAK_HTML);
      await writeFile(
        path.join(projectDir, MANIFEST_NAME),
        JSON.stringify({
          kind: 'html',
          title: LIVE_HTML_CANVAS_NAME,
          entry: LIVE_HTML_CANVAS_NAME,
          renderer: 'html',
          status: 'streaming',
          exports: ['html', 'pdf', 'zip'],
        }),
      );

      await expect(sealLiveHtmlCanvasStatus({
        projectsRoot,
        projectId: PROJECT_ID,
        name: LIVE_HTML_CANVAS_NAME,
        status: 'complete',
        readProjectFile: readProjectFile as any,
      })).resolves.toBe(false);
      expect((await readManifest(projectDir))?.status).toBe('streaming');
    });
  });

  it('is a no-op when a complete body write already landed', async () => {
    await withProject(async ({ projectsRoot, projectDir }) => {
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), CLEAN_LOGIN_HTML);
      await writeFile(
        path.join(projectDir, MANIFEST_NAME),
        JSON.stringify({
          kind: 'html',
          title: 'Login',
          entry: LIVE_HTML_CANVAS_NAME,
          renderer: 'html',
          status: 'complete',
          exports: ['html', 'pdf', 'zip'],
        }),
      );

      await expect(sealLiveHtmlCanvasStatus({
        projectsRoot,
        projectId: PROJECT_ID,
        name: LIVE_HTML_CANVAS_NAME,
        status: 'complete',
        readProjectFile: readProjectFile as any,
      })).resolves.toBe(false);
      expect((await readManifest(projectDir))?.title).toBe('Login');
    });
  });

  it('does not seal when the terminal persist failed', async () => {
    const sealed: string[] = [];
    let attempts = 0;
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 0,
      persist: async () => {
        attempts += 1;
        if (attempts > 1) throw new Error('terminal persist failed');
      },
      sealStatus: async (status) => {
        sealed.push(status);
      },
    });

    writer.note(CLEAN_LOGIN_HTML);
    await Promise.resolve();
    await expect(writer.flush('complete')).rejects.toThrow('terminal persist failed');
    expect(sealed).toEqual([]);
  });

  it('does not seal when a restore that kept nothing followed the failed persist', async () => {
    // Production ALWAYS wires `restoreIfMixed`, and on a later turn there is a
    // turn-start snapshot, so the restore runs. It returns false when disk is
    // already a single document -- it kept nothing. Clearing the persist error
    // there would launder a publication- or stub-guard refusal into a green
    // flush, and then let the seal stamp `complete` over the refused draft.
    const sealed: string[] = [];
    let attempts = 0;
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 0,
      previousCleanContent: CLEAN_LOGIN_HTML,
      persist: async () => {
        attempts += 1;
        if (attempts > 1) throw new Error('publication guard refused the page');
      },
      restoreIfMixed: async () => false,
      sealStatus: async (status) => {
        sealed.push(status);
      },
    });

    writer.note(CLEAN_LOGIN_HTML);
    await Promise.resolve();
    await expect(writer.flush('complete')).rejects.toThrow('publication guard refused');
    expect(sealed).toEqual([]);
  });

  it('still forgives a persist error when the restore actually kept the previous page', async () => {
    let attempts = 0;
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 0,
      previousCleanContent: CLEAN_LOGIN_HTML,
      persist: async () => {
        attempts += 1;
        if (attempts > 1) throw new Error('mixed document refused');
      },
      restoreIfMixed: async () => true,
      sealStatus: async () => undefined,
    });

    writer.note(CLEAN_LOGIN_HTML);
    await Promise.resolve();
    await expect(writer.flush('complete')).resolves.toBeUndefined();
  });

  it('seals on the real two-flush close sequence', async () => {
    // The daemon flushes `streaming` on child close and `complete` in the
    // finally. On the second pass the restore short-circuits (disk already
    // equals the snapshot), so the seal is the only thing left that can move
    // the status off `streaming`.
    await withProject(async ({ projectsRoot, projectDir }) => {
      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        previousCleanContent: null,
        persist: (artifact, status) => persistLiveHtmlCanvas({
          projectsRoot,
          projectId: PROJECT_ID,
          artifact,
          status,
          writeProjectFile: writeProjectFile as any,
        }),
        restoreIfMixed: (cleanContent, restore) => restoreLiveHtmlCanvasIfMixed({
          projectsRoot,
          projectId: PROJECT_ID,
          name: LIVE_HTML_CANVAS_NAME,
          previousCleanContent: cleanContent,
          force: restore?.force,
          ...(restore?.status ? { status: restore.status } : {}),
          writeProjectFile: writeProjectFile as any,
          readProjectFile: readProjectFile as any,
        }),
        sealStatus: (status) => sealLiveHtmlCanvasStatus({
          projectsRoot,
          projectId: PROJECT_ID,
          name: LIVE_HTML_CANVAS_NAME,
          status,
          readProjectFile: readProjectFile as any,
        }),
      });

      writer.note(CLEAN_LOGIN_HTML);
      expect((await waitForManifest(projectDir))?.status).toBe('streaming');
      writer.note(LIVE_PRIMARY_LEAK_HTML);

      await writer.flush('streaming');
      expect((await readManifest(projectDir))?.status).toBe('streaming');

      await writer.flush('complete');
      expect((await readManifest(projectDir))?.status).toBe('complete');
      expect(await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8'))
        .toBe(CLEAN_LOGIN_HTML);
    });
  });
});

describe('restoreLiveHtmlCanvasIfMixed manifest', () => {
  it('writes a manifest that survives validation and carries the terminal status', async () => {
    // `{ streaming: true }` was not a valid manifest -- no `renderer`, no
    // `exports` -- so writeProjectFile silently dropped it and the stale
    // status stayed on disk. Restore is the last write of the turn.
    await withProject(async ({ projectsRoot, projectDir }) => {
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), LIVE_PRIMARY_LEAK_HTML);
      await writeFile(
        path.join(projectDir, MANIFEST_NAME),
        JSON.stringify({
          version: 1,
          kind: 'html',
          title: 'Login',
          entry: LIVE_HTML_CANVAS_NAME,
          renderer: 'html',
          status: 'streaming',
          exports: ['html', 'pdf', 'zip'],
          primary: true,
          metadata: { identifier: 'login', artifactType: 'text/html', inferred: false },
        }),
      );

      await expect(restoreLiveHtmlCanvasIfMixed({
        projectsRoot,
        projectId: PROJECT_ID,
        name: LIVE_HTML_CANVAS_NAME,
        previousCleanContent: CLEAN_LOGIN_HTML,
        status: 'complete',
        writeProjectFile: writeProjectFile as any,
        readProjectFile: readProjectFile as any,
      })).resolves.toBe(true);

      expect(await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8'))
        .toBe(CLEAN_LOGIN_HTML);
      const manifest = await readManifest(projectDir);
      expect(manifest?.status).toBe('complete');
      expect(manifest?.renderer).toBe('html');
      // writeProjectFile REPLACES the sidecar. Minting a fresh minimal manifest
      // here would drop `primary` -- flipping the project's primary file to
      // another surface -- and `metadata.identifier`, which artifact recovery
      // and the stub guard both match on.
      expect(manifest?.primary).toBe(true);
      expect((manifest?.metadata as Record<string, unknown>)?.identifier).toBe('login');
      expect(manifest?.title).toBe('Login');
    });
  });

  it('still stamps streaming when no status is given', async () => {
    await withProject(async ({ projectsRoot, projectDir }) => {
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), LIVE_PRIMARY_LEAK_HTML);

      await expect(restoreLiveHtmlCanvasIfMixed({
        projectsRoot,
        projectId: PROJECT_ID,
        name: LIVE_HTML_CANVAS_NAME,
        previousCleanContent: CLEAN_LOGIN_HTML,
        writeProjectFile: writeProjectFile as any,
        readProjectFile: readProjectFile as any,
      })).resolves.toBe(true);
      expect((await readManifest(projectDir))?.status).toBe('streaming');
    });
  });
});
