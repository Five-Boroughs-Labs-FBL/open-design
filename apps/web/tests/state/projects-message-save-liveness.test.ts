import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorkspacePermissions, buildWorkspaceSeatSummary, type WorkspaceCollabContext } from '@open-design/contracts';
import { saveMessage, USER_MESSAGE_SAVE_TIMEOUT_MS } from '../../src/state/projects';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('user message save liveness', () => {
  it('isolates workspace and member queues and captures queued authority headers', async () => {
    vi.useFakeTimers();
    const context: WorkspaceCollabContext = {
      workspaceId: 'save-ws-a', workspaceMemberId: 'save-member-a', workspaceType: 'team',
      role: 'owner', memberStatus: 'active', lifecycleState: 'active', billingState: 'active',
      planId: null, providerMode: 'platform_credits',
      seatSummary: buildWorkspaceSeatSummary({ seatLimit: 1, usedSeats: 1 }),
      permissions: buildWorkspacePermissions({ role: 'owner', lifecycleState: 'active' }),
    };
    let release!: (response: Response) => void;
    const fetch = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const message = { id: 'workspace-isolation', role: 'user' as const, content: 'Edit map' };
    const initial = saveMessage('p', 'c', message, { workspaceContext: context });
    const queued = saveMessage('p', 'c', { ...message, sendFailed: true }, { workspaceContext: context });
    const otherWorkspace = saveMessage('p', 'c', message, {
      workspaceContext: { ...context, workspaceId: 'save-ws-b' },
    });
    const otherMember = saveMessage('p', 'c', message, {
      workspaceContext: { ...context, workspaceMemberId: 'save-member-b' },
    });
    try {
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch.mock.calls[1]![1].headers).toMatchObject({ 'x-od-workspace-id': 'save-ws-b' });
      expect(fetch.mock.calls[2]![1].headers).toMatchObject({ 'x-od-workspace-member-id': 'save-member-b' });
      await Promise.all([otherWorkspace, otherMember]);
      context.workspaceId = 'mutated-workspace';
      context.workspaceMemberId = 'mutated-member';
      context.role = 'member';
      context.permissions.canShareProjects = false;
      context.permissions.canWriteSyncedFiles = false;
    } finally {
      release(new Response('{}'));
      await Promise.all([initial, queued]);
    }
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3]![1].headers).toMatchObject({
      'x-od-workspace-id': 'save-ws-a', 'x-od-workspace-member-id': 'save-member-a',
      'x-od-workspace-role': 'owner', 'x-od-workspace-can-share-projects': 'true',
      'x-od-workspace-can-write-synced-files': 'true',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['headers', 'body'] as const)(
    'releases a retry failure save when the preceding request stalls at %s',
    async (stallAt) => {
      vi.useFakeTimers();
      let release!: (response: Response) => void;
      let releaseBody!: (value: unknown) => void;
      const stalledResponse = new Response('{}');
      const body = new Promise<unknown>((resolve) => { releaseBody = resolve; });
      vi.spyOn(stalledResponse, 'json').mockReturnValue(body);
      const headers = new Promise<Response>((resolve) => { release = resolve; });
      const fetch = vi.fn()
        .mockReturnValueOnce(stallAt === 'headers' ? headers : Promise.resolve(stalledResponse))
        .mockResolvedValue(new Response('{}'));
      vi.stubGlobal('fetch', fetch);
      const message = { id: `stalled-${stallAt}`, role: 'user' as const, content: 'Edit map' };
      const initial = saveMessage('p', 'c', message);
      const failure = saveMessage('p', 'c', { ...message, sendFailed: true, sendFailureDetail: 'offline' });
      try {
        expect(fetch).toHaveBeenCalledTimes(1);
        // Persistence is best effort. One missing response must not hold the
        // row's newest retry/failure state forever; use only virtual time.
        const firstSignal = fetch.mock.calls[0]![1].signal as AbortSignal;
        await vi.advanceTimersByTimeAsync(USER_MESSAGE_SAVE_TIMEOUT_MS - 1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(firstSignal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(firstSignal.aborted).toBe(true);
        expect(await initial).toBeNull();
        await failure;
        expect(vi.getTimerCount()).toBe(0);
        expect(JSON.parse(fetch.mock.calls[1]![1].body as string).sendFailed).toBe(true);
      } finally {
        release(new Response('{}'));
        releaseBody({});
        await Promise.all([initial, failure]);
        expect(await initial).toBeNull();
        expect(fetch).toHaveBeenCalledTimes(2);
      }
    },
  );

  it('captures queued user payloads and lets independent rows and assistants save immediately', async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const fetch = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }))
      .mockImplementation((_url: string, init: RequestInit) =>
        Promise.resolve(new Response(JSON.stringify({ message: JSON.parse(init.body as string) }))));
    vi.stubGlobal('fetch', fetch);
    const base = { id: 'capture-u', role: 'user' as const, content: 'original' };
    const initial = saveMessage('p', 'c', base);
    const queued = { ...base, content: 'queued', sendFailed: true, sendFailureDetail: 'offline' };
    const pending = saveMessage('p', 'c', queued);
    queued.content = 'mutated after call';
    queued.sendFailureDetail = 'mutated detail';
    const other = saveMessage('p', 'c', { ...base, id: 'independent-u' });
    const assistant = saveMessage('p', 'c', { id: 'assistant', role: 'assistant', content: 'answer' }, { keepalive: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]![1]).toMatchObject({ keepalive: true });
    expect(fetch.mock.calls[2]![1].signal).toBeUndefined();
    await Promise.all([other, assistant]);
    release(new Response('{}'));
    await initial;
    expect(await pending).toMatchObject({ content: 'queued', sendFailureDetail: 'offline' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears deadlines after JSON rejection and releases the next save', async () => {
    vi.useFakeTimers();
    const malformed = new Response('{broken');
    const fetch = vi.fn().mockResolvedValueOnce(malformed).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const message = { id: 'json-rejection', role: 'user' as const, content: 'Edit map' };
    const first = saveMessage('p', 'c', message);
    const second = saveMessage('p', 'c', { ...message, sendFailed: true });
    expect(await first).toBeNull();
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect((fetch.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(false);
  });

  it('keeps serialization failures best effort without occupying the row queue', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const message = { id: 'circular', role: 'user' as const, content: 'Edit map' };
    const circular = { ...message, unsupported: null as unknown };
    circular.unsupported = circular;
    expect(await saveMessage('p', 'c', circular)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await saveMessage('p', 'c', message);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a late request rejection after releasing the queue', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const fetch = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((_resolve, fail) => { reject = fail; }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const message = { id: 'late-reject', role: 'user' as const, content: 'Edit map' };
    const first = saveMessage('p', 'c', message);
    const second = saveMessage('p', 'c', { ...message, sendFailed: true });
    await vi.advanceTimersByTimeAsync(USER_MESSAGE_SAVE_TIMEOUT_MS);
    expect(await first).toBeNull();
    await second;
    reject(new Error('late disconnect'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
