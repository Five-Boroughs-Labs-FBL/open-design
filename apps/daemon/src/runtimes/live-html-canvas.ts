import type { PlainStreamArtifact } from './plain-stream.js';
import { extractLiveHtmlCanvasArtifact } from './plain-stream.js';

export type LiveHtmlCanvasStatus = 'streaming' | 'complete';

export function createLiveHtmlCanvasWriter(options: {
  persist: (
    artifact: PlainStreamArtifact,
    status: LiveHtmlCanvasStatus,
  ) => Promise<unknown>;
  delayMs?: number;
}) {
  const delayMs = options.delayMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PlainStreamArtifact | null = null;
  let lastStreamingContent = '';
  let lastStatus: LiveHtmlCanvasStatus | null = null;
  let wrote = false;
  let sealed = false;
  let chain = Promise.resolve();
  let persistError: unknown = null;

  function enqueue(status: LiveHtmlCanvasStatus) {
    const artifact = pending;
    if (!artifact) return;
    if (
      status === 'streaming'
      && artifact.content === lastStreamingContent
      && lastStatus === 'streaming'
    ) {
      return;
    }
    const snapshot = artifact;
    chain = chain
      .then(async () => {
        if (
          status === 'streaming'
          && snapshot.content === lastStreamingContent
          && lastStatus === 'streaming'
        ) {
          return;
        }
        lastStreamingContent = snapshot.content;
        lastStatus = status;
        wrote = true;
        await options.persist(snapshot, status);
      })
      .catch((err) => {
        persistError = err;
      });
  }

  return {
    get wrote() {
      return wrote;
    },
    note(text: string) {
      if (sealed) return;
      const artifact = extractLiveHtmlCanvasArtifact(text);
      if (!artifact) return;
      pending = artifact;
      if (!wrote) {
        wrote = true;
        enqueue('streaming');
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        enqueue('streaming');
      }, delayMs);
    },
    async flush(status: LiveHtmlCanvasStatus) {
      if (sealed) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      enqueue(status);
      await chain;
      if (status === 'complete') sealed = true;
      if (persistError) {
        const err = persistError;
        persistError = null;
        throw err;
      }
    },
  };
}
