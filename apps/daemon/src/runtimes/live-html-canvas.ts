import { isSingleHtmlDocument } from '../artifacts/html-document.js';
import type { PlainStreamArtifact } from './plain-stream.js';
import { extractLiveHtmlCanvasArtifact, liveHtmlSourceIsBroken } from './plain-stream.js';

export type LiveHtmlCanvasStatus = 'streaming' | 'complete';

export function createLiveHtmlCanvasWriter(options: {
  persist: (
    artifact: PlainStreamArtifact,
    status: LiveHtmlCanvasStatus,
  ) => Promise<unknown | false>;
  /**
   * Called when extract cannot unwrap a mixed dump, or after flush in case a
   * child Write overwrote the live file. Receives the turn-start snapshot
   * (not a later streaming false-start draft).
   */
  restoreIfMixed?: (
    cleanContent: string,
    restore?: { force?: boolean; status?: LiveHtmlCanvasStatus },
  ) => Promise<unknown>;
  /**
   * Stamp a terminal status on the live primary already on disk, without
   * rewriting its body. Called on a `complete` flush so a turn that never
   * produced a `complete` body write still leaves a finished file.
   */
  sealStatus?: (status: LiveHtmlCanvasStatus) => Promise<unknown>;
  previousCleanContent?: string | null;
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
  let streamBroken = false;
  const turnStartClean =
    options.previousCleanContent && isSingleHtmlDocument(options.previousCleanContent)
      ? options.previousCleanContent
      : null;
  let cleanToRestore = turnStartClean;

  function enqueueRestore(force: boolean, status: LiveHtmlCanvasStatus) {
    if (!options.restoreIfMixed) return;
    chain = chain
      .then(async () => {
        const clean = turnStartClean ?? cleanToRestore;
        if (!clean) return;
        await options.restoreIfMixed?.(clean, { force, status });
        // A recoverable keep-previous must not fail the run.
        persistError = null;
      })
      .catch((err) => {
        persistError = err;
      });
  }

  /**
   * A stream that ends mixed clears `pending`, so `flush` has no body to
   * persist and the file keeps the status of the last streaming draft — a
   * tile that renders as "still working" for good. Restore cannot cover this:
   * on a first run there is no turn-start snapshot to restore, so it no-ops
   * and writes nothing at all. Sealing works from what is already on disk and
   * is refused unless that really is one HTML document.
   */
  function enqueueSeal(status: LiveHtmlCanvasStatus) {
    if (!options.sealStatus) return;
    chain = chain
      .then(async () => {
        // A failed persist is about to reject flush(); do not call that done.
        if (persistError) return;
        await options.sealStatus?.(status);
      })
      .catch((err) => {
        persistError = err;
      });
  }

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
        if (persisted !== false) {
          persistError = null;
          // Do not replace the turn-start snapshot with a streaming draft.
          // A prefix before an `<artifact>` restart is a single document and
          // must not become the restore source.
          if (status === 'complete' && isSingleHtmlDocument(snapshot.content)) {
            cleanToRestore = snapshot.content;
          }
        }
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
      if (!artifact) {
        if (liveHtmlSourceIsBroken(text)) {
          streamBroken = true;
          pending = null;
          enqueueRestore(true, 'streaming');
        }
        return;
      }
      streamBroken = false;
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
      if (streamBroken) {
        enqueueRestore(true, status);
      } else {
        enqueue(status);
        enqueueRestore(false, status);
      }
      // Idempotent: a no-op when a `complete` body write already landed.
      if (status === 'complete') enqueueSeal(status);
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
