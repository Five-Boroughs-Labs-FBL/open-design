import { describe, expect, it, vi } from 'vitest';

import { createLiveHtmlCanvasWriter } from '../../src/runtimes/live-html-canvas.js';
import { LIVE_HTML_CANVAS_NAME } from '../../src/runtimes/plain-stream.js';

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
});
