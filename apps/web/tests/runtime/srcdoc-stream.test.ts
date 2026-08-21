import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { buildLazySrcdocTransport } from '../../src/runtime/srcdoc';
import {
  SRCDOC_STREAM_MESSAGE_TYPE,
  SRCDOC_STREAM_READY_TYPE,
  buildSrcDocTransportIdentity,
  canPostSrcDocStream,
  injectLiveHtmlStreamBridge,
  liveHtmlStreamTransportKey,
  planSrcDocStreamWrite,
  srcDocStreamShouldReset,
} from '../../src/runtime/srcdoc-stream';

function extractShellScript(shellHtml: string): string {
  const match = shellHtml.match(
    /<script\s+data-od-lazy-srcdoc-transport>([\s\S]*?)<\/script>/,
  );
  if (!match || match[1] == null) {
    throw new Error('lazy transport shell script not found');
  }
  return match[1];
}

function extractInjectedBridge(html: string): string {
  const match = html.match(
    /<script\s+data-od-srcdoc-stream-bridge>([\s\S]*?)<\/script>/,
  );
  if (!match || match[1] == null) {
    throw new Error('injected stream bridge not found');
  }
  return match[1];
}

interface DocumentSpy {
  open: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  writes: string[];
}

function makeDocumentSpy(): DocumentSpy {
  const writes: string[] = [];
  const spy: DocumentSpy = {
    open: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
    }),
    close: vi.fn(),
    writes,
  };
  return spy;
}

function runScript(script: string, documentSpy: DocumentSpy) {
  const parentMessages: unknown[] = [];
  const messageListeners: Array<(ev: { data: unknown }) => void> = [];
  const win: Record<string, unknown> = {
    addEventListener(_type: string, listener: (ev: { data: unknown }) => void) {
      messageListeners.push(listener);
    },
  };
  win.parent = {
    postMessage: (data: unknown) => {
      parentMessages.push(data);
    },
  };
  const sandbox: Record<string, unknown> = {
    document: documentSpy,
    window: win,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return {
    parentMessages,
    post: (data: unknown) => {
      for (const listener of messageListeners) listener({ data });
    },
  };
}

describe('planSrcDocStreamWrite', () => {
  it('opens and writes the first snapshot without closing', () => {
    const { next, op } = planSrcDocStreamWrite(null, {
      html: '<html><head>',
      generation: 'g1',
    });
    expect(op).toEqual({ type: 'open-write', html: '<html><head>', close: false });
    expect(next.written).toBe('<html><head>');
  });

  it('appends only the new suffix when HTML grows', () => {
    const first = planSrcDocStreamWrite(null, {
      html: '<html><head>',
      generation: 'g1',
    });
    const { op } = planSrcDocStreamWrite(first.next, {
      html: '<html><head><style>body{color:red}</style></head><body>',
      generation: 'g1',
    });
    expect(op).toEqual({
      type: 'append',
      delta: '<style>body{color:red}</style></head><body>',
      close: false,
    });
  });

  it('does not rewrite when the same HTML is posted again', () => {
    const first = planSrcDocStreamWrite(null, {
      html: '<p>hud</p>',
      generation: 'g1',
    });
    const { op } = planSrcDocStreamWrite(first.next, {
      html: '<p>hud</p>',
      generation: 'g1',
    });
    expect(op).toEqual({ type: 'noop', close: false });
  });

  it('closes only when the stream is done', () => {
    const first = planSrcDocStreamWrite(null, {
      html: '<html>',
      generation: 'g1',
    });
    const { op } = planSrcDocStreamWrite(first.next, {
      html: '<html><body>done</body></html>',
      generation: 'g1',
      done: true,
    });
    expect(op.type).toBe('append');
    if (op.type !== 'append') throw new Error('expected append');
    expect(op.close).toBe(true);
    expect(op.delta).toBe('<body>done</body></html>');
  });

  it('rewrites when the generation changes', () => {
    const first = planSrcDocStreamWrite(null, {
      html: '<html>a</html>',
      generation: 'g1',
    });
    const { op } = planSrcDocStreamWrite(first.next, {
      html: '<html>b</html>',
      generation: 'g2',
    });
    expect(op.type).toBe('open-write');
  });
});

describe('canPostSrcDocStream', () => {
  const base = {
    html: '<html></html>',
    useUrlLoadPreview: false,
    useLazySrcDocTransport: true,
    shellReady: true,
  };

  it('posts when the lazy shell is ready and srcDoc is active', () => {
    expect(canPostSrcDocStream(base)).toBe(true);
  });

  it('waits for shell ready and refuses URL-load / empty html', () => {
    expect(canPostSrcDocStream({ ...base, shellReady: false })).toBe(false);
    expect(canPostSrcDocStream({ ...base, useUrlLoadPreview: true })).toBe(false);
    expect(canPostSrcDocStream({ ...base, useLazySrcDocTransport: false })).toBe(false);
    expect(canPostSrcDocStream({ ...base, html: '' })).toBe(false);
  });
});

describe('srcDocStreamShouldReset / liveHtmlStreamTransportKey', () => {
  it('pins one cache key for the whole live stream', () => {
    expect(liveHtmlStreamTransportKey('file-a')).toBe('file-a\0live-html-stream');
  });

  it('does not change transport identity when live HTML length (file size) grows', () => {
    const base = {
      streamingLiveHtml: true,
      previewBaseIdentity: 'proj\0index.html',
      reloadKey: 0,
      measurementEpoch: 'epoch-1',
      kind: 'html' as const,
      baseHref: 'https://example.test/',
    };
    expect(buildSrcDocTransportIdentity({
      ...base,
      sourceSnapshotRefreshKey: '0:12:0',
    })).toBe(buildSrcDocTransportIdentity({
      ...base,
      sourceSnapshotRefreshKey: '0:4800:0',
    }));
    expect(buildSrcDocTransportIdentity({
      ...base,
      streamingLiveHtml: false,
      sourceSnapshotRefreshKey: '0:12:0',
    })).not.toBe(buildSrcDocTransportIdentity({
      ...base,
      streamingLiveHtml: false,
      sourceSnapshotRefreshKey: '0:4800:0',
    }));
  });

  it('remounts only when HTML is a different document, not when it grows', () => {
    const skin = '<html><head><style>';
    const more = `${skin}body{background:#000}</style></head><body><header>`;
    expect(srcDocStreamShouldReset('', skin)).toBe(false);
    expect(srcDocStreamShouldReset(skin, more)).toBe(false);
    expect(srcDocStreamShouldReset(more, '<html><head>other')).toBe(true);
    expect(srcDocStreamShouldReset(more, '')).toBe(true);
  });
});

describe('injectLiveHtmlStreamBridge', () => {
  it('injects the stream bridge immediately after <head> and escapes </script>', () => {
    const html = '<!doctype html><html><head><style>body{}</style></head><body></body></html>';
    const injected = injectLiveHtmlStreamBridge(html, 'g1');
    expect(injected).toContain('data-od-srcdoc-stream-bridge');
    expect(injected.indexOf('data-od-srcdoc-stream-bridge')).toBeGreaterThan(injected.indexOf('<head>'));
    expect(injected.indexOf('data-od-srcdoc-stream-bridge')).toBeLessThan(injected.indexOf('<style>'));
    const withScript = injectLiveHtmlStreamBridge('<head></head></script>', 'g1');
    const bridge = extractInjectedBridge(withScript);
    expect(bridge).not.toContain('</script>');
    expect(bridge).toContain('\\u003c');
  });
});

describe('lazy shell live HTML stream', () => {
  it('still rewrites+closes on activate (non-stream path)', () => {
    const documentSpy = makeDocumentSpy();
    const { post } = runScript(extractShellScript(buildLazySrcdocTransport()), documentSpy);
    post({
      type: 'od:srcdoc-transport-activate',
      html: '<p>full</p>',
      generation: 'generation-1',
    });
    expect(documentSpy.open).toHaveBeenCalledTimes(1);
    expect(documentSpy.writes).toEqual(['<p>full</p>']);
    expect(documentSpy.close).toHaveBeenCalledTimes(1);
  });

  it('open+writes the first stream snapshot without closing the document', () => {
    const documentSpy = makeDocumentSpy();
    const { parentMessages, post } = runScript(
      extractShellScript(buildLazySrcdocTransport()),
      documentSpy,
    );
    expect(parentMessages).toContainEqual({ type: 'od:srcdoc-transport-ready' });
    const skin = '<!doctype html><html><head><style>body{background:#020617}</style></head><body>';
    post({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: skin,
      generation: 'g1',
    });
    expect(documentSpy.open).toHaveBeenCalledTimes(1);
    expect(documentSpy.close).not.toHaveBeenCalled();
    expect(documentSpy.writes).toHaveLength(1);
    expect(documentSpy.writes[0]).toContain('<style>body{background:#020617}</style></head><body>');
    expect(documentSpy.writes[0]).toContain('data-od-srcdoc-stream-bridge');
  });

  it('appends component HTML without opening a new document', () => {
    const shellDoc = makeDocumentSpy();
    const { post: postToShell } = runScript(
      extractShellScript(buildLazySrcdocTransport()),
      shellDoc,
    );
    const skin = '<!doctype html><html><head><style>body{background:#020617}</style></head><body>';
    postToShell({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: skin,
      generation: 'g1',
    });
    const injected = extractInjectedBridge(shellDoc.writes[0] ?? '');
    const streamDoc = makeDocumentSpy();
    const { parentMessages, post: postToBridge } = runScript(injected, streamDoc);
    expect(parentMessages).toContainEqual({
      type: SRCDOC_STREAM_READY_TYPE,
      generation: 'g1',
    });

    const withRadio = `${skin}<header>RADIO</header>`;
    postToBridge({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: withRadio,
      generation: 'g1',
    });
    const withStart = `${withRadio}<button>START</button>`;
    postToBridge({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: withStart,
      generation: 'g1',
    });
    postToBridge({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: withStart,
      generation: 'g1',
    });

    expect(streamDoc.open).not.toHaveBeenCalled();
    expect(streamDoc.close).not.toHaveBeenCalled();
    expect(streamDoc.writes).toEqual([
      '<header>RADIO</header>',
      '<button>START</button>',
    ]);
  });

  it('closes once when the stream is done', () => {
    const shellDoc = makeDocumentSpy();
    const { post: postToShell } = runScript(
      extractShellScript(buildLazySrcdocTransport()),
      shellDoc,
    );
    postToShell({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: '<html><body>',
      generation: 'g1',
    });
    const injected = extractInjectedBridge(shellDoc.writes[0] ?? '');
    const streamDoc = makeDocumentSpy();
    const { post } = runScript(injected, streamDoc);
    post({
      type: SRCDOC_STREAM_MESSAGE_TYPE,
      html: '<html><body><p>HUD</p></body></html>',
      generation: 'g1',
      done: true,
    });
    expect(streamDoc.open).not.toHaveBeenCalled();
    expect(streamDoc.writes).toEqual(['<p>HUD</p></body></html>']);
    expect(streamDoc.close).toHaveBeenCalledTimes(1);
  });
});
