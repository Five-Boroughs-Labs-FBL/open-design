import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createLiveHtmlCanvasWriter } from '../../src/runtimes/live-html-canvas.js';
import {
  LIVE_HTML_CANVAS_NAME,
  persistLiveHtmlCanvas,
} from '../../src/runtimes/plain-stream.js';
import { writeProjectFile } from '../../src/projects.js';

describe('createLiveHtmlCanvasWriter', () => {
  it('writes the first draft immediately and overwrites the same name', async () => {
    vi.useFakeTimers();
    const writes: Array<{ name: string; status: string; content: string }> = [];
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 300,
      persist: async (artifact, status) => {
        writes.push({ name: artifact.fileName, status, content: artifact.content });
      },
    });

    writer.note('<artifact type="text/html"><!doctype html><html><body>A');
    writer.note('<artifact type="text/html"><!doctype html><html><body>AA');
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      name: LIVE_HTML_CANVAS_NAME,
      status: 'streaming',
      content: '<!doctype html><html><body>A',
    });

    writer.note('<artifact type="text/html"><!doctype html><html><body>AB');
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.content).toBe('<!doctype html><html><body>AB');

    await writer.flush('complete');
    expect(writes.at(-1)?.status).toBe('complete');
    expect(writes.every((write) => write.name === LIVE_HTML_CANVAS_NAME)).toBe(true);
    vi.useRealTimers();
  });

  it('flushes an unclosed artifact on cancel without waiting for the debounce', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 300,
      persist: async (artifact, status) => {
        writes.push(`${status}:${artifact.content}`);
      },
    });
    writer.note('<artifact type="text/html"><!doctype html><html>A');
    await Promise.resolve();
    writer.note('<artifact type="text/html"><!doctype html><html>AB');
    await writer.flush('streaming');
    expect(writes.at(-1)).toBe('streaming:<!doctype html><html>AB');
    await vi.advanceTimersByTimeAsync(300);
    expect(writes.filter((entry) => entry.startsWith('streaming:'))).toHaveLength(2);
    vi.useRealTimers();
  });

  it('ignores later drafts after a complete flush', async () => {
    const writes: string[] = [];
    const writer = createLiveHtmlCanvasWriter({
      persist: async (artifact, status) => {
        writes.push(`${status}:${artifact.content.length}`);
      },
    });
    writer.note('<artifact type="text/html"><!doctype html><html>A');
    await writer.flush('complete');
    const afterComplete = writes.length;
    writer.note('<artifact type="text/html"><!doctype html><html>AB');
    await writer.flush('streaming');
    expect(writes.at(-1)?.startsWith('complete:')).toBe(true);
    expect(writes.length).toBe(afterComplete);
  });

  it('throttles sustained tokens instead of resetting the timer on every note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'));
    const writes: string[] = [];
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 300,
      persist: async (artifact) => {
        writes.push(artifact.content);
      },
    });
    writer.note('<artifact type="text/html"><!doctype html><html><body>0');
    await Promise.resolve();
    expect(writes).toEqual(['<!doctype html><html><body>0']);

    for (let i = 1; i <= 12; i += 1) {
      await vi.advanceTimersByTimeAsync(50);
      writer.note(`<artifact type="text/html"><!doctype html><html><body>${'x'.repeat(i)}`);
    }
    await Promise.resolve();
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.at(-1)).not.toBe('<!doctype html><html><body>0');

    await writer.flush('complete');
    expect(writes.at(-1)).toBe(`<!doctype html><html><body>${'x'.repeat(12)}`);
    vi.useRealTimers();
  });

  it('recovers when thought HTML precedes an identified secondary surface', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-targeted-live-thought-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(path.join(projectDir, 'screens'), { recursive: true });
      await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><title>Entry</title>');
      const target = { surfaceId: 'billing', file: 'screens/billing.html' };
      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        persist: (artifact, status) => persistLiveHtmlCanvas({
          projectsRoot,
          projectId: 'project-1',
          artifact,
          status,
          target,
          writeProjectFile: writeProjectFile as any,
        }),
      });

      const thought = '<!doctype html><html><body>Thinking draft</body></html>';
      writer.note(thought);
      await Promise.resolve();
      writer.note([
        thought,
        '<artifact identifier="billing" type="text/html">',
        '<!doctype html><html><body>Billing screen</body></html>',
        '</artifact>',
      ].join('\n'));

      await expect(writer.flush('complete')).resolves.toBeUndefined();
      expect(await readFile(path.join(projectDir, 'index.html'), 'utf8')).toContain('Entry');
      expect(await readFile(path.join(projectDir, 'screens', 'billing.html'), 'utf8'))
        .toContain('Billing screen');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('still rejects when a terminal persist fails after an earlier success', async () => {
    let attempts = 0;
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 0,
      persist: async () => {
        attempts += 1;
        if (attempts > 1) throw new Error('terminal persist failed');
      },
    });

    writer.note('<!doctype html><html><body>Initial persisted draft</body></html>');
    await Promise.resolve();
    await expect(writer.flush('complete')).rejects.toThrow('terminal persist failed');
  });

  it('does not clear a persist error when a later ownership check no-ops', async () => {
    let attempts = 0;
    const writer = createLiveHtmlCanvasWriter({
      delayMs: 0,
      persist: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('draft persist failed');
        return false;
      },
    });

    writer.note('<!doctype html><html><body>Unpersisted draft</body></html>');
    await Promise.resolve();
    await expect(writer.flush('complete')).rejects.toThrow('draft persist failed');
  });

  it('persists only the inner page from an artifact-envelope + second-doctype stream', async () => {
    const {
      ARTIFACT_ENVELOPE_LEAK_OPEN_HTML,
      CLEAN_LOGIN_HTML,
      MOBILE_LOGIN_HTML,
    } = await import('../artifacts/html-document.fixtures.js');
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-html-envelope-writer-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), CLEAN_LOGIN_HTML);

      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        previousCleanContent: CLEAN_LOGIN_HTML,
        persist: (artifact, status) => persistLiveHtmlCanvas({
          projectsRoot,
          projectId: 'project-1',
          artifact,
          status,
          previousCleanContent: CLEAN_LOGIN_HTML,
          writeProjectFile: writeProjectFile as any,
        }),
      });

      const prefix = ARTIFACT_ENVELOPE_LEAK_OPEN_HTML.slice(
        0,
        ARTIFACT_ENVELOPE_LEAK_OPEN_HTML.indexOf('<artifact'),
      );
      writer.note(prefix);
      await Promise.resolve();
      writer.note(ARTIFACT_ENVELOPE_LEAK_OPEN_HTML);
      await expect(writer.flush('complete')).resolves.toBeUndefined();
      const body = await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toBe(MOBILE_LOGIN_HTML);
      expect(body).not.toContain('<artifact identifier="login"');
      expect(body).not.toContain('maximum-scale=1.');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('restores the turn-start snapshot without throwing when unwrap still leaves a mixed dump', async () => {
    const {
      ARTIFACT_ENVELOPE_MIXED_INNER_HTML,
      CLEAN_LOGIN_HTML,
    } = await import('../artifacts/html-document.fixtures.js');
    const { restoreLiveHtmlCanvasIfMixed } = await import(
      '../../src/runtimes/plain-stream.js'
    );
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-html-envelope-restore-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), CLEAN_LOGIN_HTML);
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), ARTIFACT_ENVELOPE_MIXED_INNER_HTML);

      const persists: string[] = [];
      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        previousCleanContent: CLEAN_LOGIN_HTML,
        persist: async (artifact) => {
          persists.push(artifact.content);
        },
        restoreIfMixed: (cleanContent, restore) => restoreLiveHtmlCanvasIfMixed({
          projectsRoot,
          projectId: 'project-1',
          name: LIVE_HTML_CANVAS_NAME,
          previousCleanContent: cleanContent,
          force: restore?.force,
          writeProjectFile: writeProjectFile as any,
        }),
      });

      writer.note(ARTIFACT_ENVELOPE_MIXED_INNER_HTML);
      await expect(writer.flush('complete')).resolves.toBeUndefined();
      expect(persists).toEqual([]);
      const body = await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toBe(CLEAN_LOGIN_HTML);
      expect(body).not.toContain('<artifact identifier="login"');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('force-restores the turn-start snapshot after a streaming prefix then a mixed envelope', async () => {
    const {
      ARTIFACT_ENVELOPE_MIXED_INNER_HTML,
      CLEAN_LOGIN_HTML,
    } = await import('../artifacts/html-document.fixtures.js');
    const { restoreLiveHtmlCanvasIfMixed } = await import(
      '../../src/runtimes/plain-stream.js'
    );
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-html-prefix-restore-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), CLEAN_LOGIN_HTML);

      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        previousCleanContent: CLEAN_LOGIN_HTML,
        persist: (artifact, status) => persistLiveHtmlCanvas({
          projectsRoot,
          projectId: 'project-1',
          artifact,
          status,
          previousCleanContent: CLEAN_LOGIN_HTML,
          writeProjectFile: writeProjectFile as any,
        }),
        restoreIfMixed: (cleanContent, restore) => restoreLiveHtmlCanvasIfMixed({
          projectsRoot,
          projectId: 'project-1',
          name: LIVE_HTML_CANVAS_NAME,
          previousCleanContent: cleanContent,
          force: restore?.force,
          writeProjectFile: writeProjectFile as any,
        }),
      });

      const prefix = ARTIFACT_ENVELOPE_MIXED_INNER_HTML.slice(
        0,
        ARTIFACT_ENVELOPE_MIXED_INNER_HTML.indexOf('<artifact'),
      );
      writer.note(prefix);
      writer.note(ARTIFACT_ENVELOPE_MIXED_INNER_HTML);
      await expect(writer.flush('complete')).resolves.toBeUndefined();
      const body = await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toBe(CLEAN_LOGIN_HTML);
      expect(body).not.toContain('<artifact identifier="login"');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('restores the previous clean file when the stream is the leaked mixed dump', async () => {
    const { CLEAN_LOGIN_HTML, LIVE_PRIMARY_LEAK_HTML } = await import(
      '../artifacts/html-document.fixtures.js'
    );
    const { restoreLiveHtmlCanvasIfMixed } = await import(
      '../../src/runtimes/plain-stream.js'
    );
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-html-restore-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), CLEAN_LOGIN_HTML);
      // Child Write already dumped the mixed document onto the live primary.
      await writeFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), LIVE_PRIMARY_LEAK_HTML);

      const persists: string[] = [];
      const writer = createLiveHtmlCanvasWriter({
        delayMs: 0,
        previousCleanContent: CLEAN_LOGIN_HTML,
        persist: async (artifact) => {
          persists.push(artifact.content);
        },
        restoreIfMixed: (cleanContent, restore) => restoreLiveHtmlCanvasIfMixed({
          projectsRoot,
          projectId: 'project-1',
          name: LIVE_HTML_CANVAS_NAME,
          previousCleanContent: cleanContent,
          force: restore?.force,
          writeProjectFile: writeProjectFile as any,
        }),
      });

      writer.note(LIVE_PRIMARY_LEAK_HTML);
      await writer.flush('complete');
      expect(persists).toEqual([]);
      const body = await readFile(path.join(projectDir, LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toBe(CLEAN_LOGIN_HTML);
      expect(body).not.toContain('```html');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });
});
