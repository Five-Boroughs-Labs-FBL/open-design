import type { PlainStreamArtifact } from './plain-stream.js';
import { extractLiveHtmlCanvasArtifact } from './plain-stream.js';

export type LiveHtmlCanvasStatus = 'streaming' | 'complete';

export function createLiveHtmlCanvasWriter(options: {
  persist: (
    artifact: PlainStreamArtifact,
    status: LiveHtmlCanvasStatus,
  ) => Promise<unknown | false>;
  delayMs?: number;
}) {
  const delayMs = options.delayMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PlainStreamArtifact | null = null;
  let lastStreamingContent = '';
  let lastStatus: LiveHtmlCanvasStatus | null = null;
  let wrote = false;
  let sealed = false;
  let lastWriteAt: number | null = null;
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
        lastWriteAt ??= Date.now();
        const persisted = await options.persist(snapshot, status);
        // Streaming extraction can first surface an unattributed HTML draft
        // before a provider emits the authoritative <artifact identifier>.
        // A later successful snapshot supersedes that recoverable failure;
        // only the most recent unresolved persist error should fail flush().
        // `false` is an ownership no-op, not a successful persistence.
        if (persisted !== false) persistError = null;
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
        lastWriteAt = Date.now();
        enqueue('streaming');
        return;
      }
      // Throttle, not debounce: later tokens must not reset an armed timer or
      // a crash mid-stream leaves only the first ~doctype stub on disk.
      if (timer) return;
      const elapsed = lastWriteAt == null ? delayMs : Date.now() - lastWriteAt;
      const wait = Math.max(0, delayMs - elapsed);
      if (wait === 0) {
        enqueue('streaming');
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        enqueue('streaming');
      }, wait);
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
