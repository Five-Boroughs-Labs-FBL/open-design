import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveMessage } from '../../src/state/projects';

afterEach(() => vi.unstubAllGlobals());

describe('user message save ordering', () => {
  it('keeps retry clears ahead of new failures while other rows can save', async () => {
    const requests: { body: Record<string, unknown>; finish: () => void }[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve) => {
      const body = JSON.parse(options.body as string);
      requests.push({ body, finish: () => resolve(new Response(JSON.stringify({ message: body }))) });
    })));
    const base = { id: 'u', role: 'user' as const, content: 'Edit map' };
    const clear = saveMessage('p', 'c', base);
    const failure = saveMessage('p', 'c', { ...base, sendFailed: true, sendFailureDetail: '503 unavailable' });
    const other = saveMessage('p', 'c', { ...base, id: 'other' });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body.sendFailed).toBeUndefined();
    // Complete the independent row first; it cannot release this row's queue.
    requests[1]!.finish();
    await other;
    expect(requests).toHaveLength(2);
    requests[0]!.finish();
    await clear;
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]?.body.sendFailed).toBe(true);
    requests[2]!.finish();
    await failure;
    const next = saveMessage('p', 'c', base);
    expect(requests).toHaveLength(4);
    requests[3]!.finish();
    await next;
  });

  it('releases the next write after a failed request', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const message = { id: 'u', role: 'user' as const, content: 'Edit map' };
    const first = saveMessage('p', 'c', message);
    const second = saveMessage('p', 'c', { ...message, sendFailed: true });
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
