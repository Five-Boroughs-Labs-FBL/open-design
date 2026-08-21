/**
 * Incremental live-HTML srcDoc transport.
 *
 * Default srcDoc activation does `document.open(); write(fullHtml); close()`
 * on every chunk, which reloads the iframe (the flicker). During a live
 * `<artifact>` stream we keep one document open and append only new bytes so
 * the page stays and complete tags appear as they arrive.
 */

export const SRCDOC_STREAM_MESSAGE_TYPE = 'od:srcdoc-transport-stream';
export const SRCDOC_STREAM_READY_TYPE = 'od:srcdoc-stream-ready';

export interface SrcDocStreamState {
  written: string;
  generation: string;
}

export type SrcDocStreamOp =
  | { type: 'open-write'; html: string; close: boolean }
  | { type: 'append'; delta: string; close: boolean }
  | { type: 'noop'; close: boolean };

export function planSrcDocStreamWrite(
  state: SrcDocStreamState | null,
  incoming: { html: string; generation: string; done?: boolean },
): { next: SrcDocStreamState; op: SrcDocStreamOp } {
  const close = Boolean(incoming.done);
  const next = { written: incoming.html, generation: incoming.generation };
  if (!state || state.generation !== incoming.generation) {
    return { next, op: { type: 'open-write', html: incoming.html, close } };
  }
  if (incoming.html === state.written) {
    return { next: state, op: { type: 'noop', close } };
  }
  if (incoming.html.startsWith(state.written)) {
    return {
      next,
      op: {
        type: 'append',
        delta: incoming.html.slice(state.written.length),
        close,
      },
    };
  }
  return { next, op: { type: 'open-write', html: incoming.html, close } };
}

export function canPostSrcDocStream(state: {
  html: string;
  useUrlLoadPreview: boolean;
  useLazySrcDocTransport: boolean;
  shellReady: boolean;
}): boolean {
  if (!state.html) return false;
  if (state.useUrlLoadPreview) return false;
  if (!state.useLazySrcDocTransport) return false;
  if (!state.shellReady) return false;
  return true;
}

export function liveHtmlStreamTransportKey(identity: string): string {
  return `${identity}\0live-html-stream`;
}

/** New artifact (or unrelated HTML) should remount the lazy shell. */
export function srcDocStreamShouldReset(previous: string, next: string): boolean {
  if (!previous) return false;
  if (!next) return true;
  return !next.startsWith(previous) && !previous.startsWith(next);
}

export function encodeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function injectLiveHtmlStreamBridge(html: string, generation: string): string {
  const bridge = `<script data-od-srcdoc-stream-bridge>${buildLiveHtmlStreamBridgeSource(html, generation)}</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index != null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + bridge + html.slice(at);
  }
  const root = html.match(/<html[^>]*>/i);
  if (root && root.index != null) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${bridge}</head>${html.slice(at)}`;
  }
  return bridge + html;
}

export function buildLiveHtmlStreamBridgeSource(writtenHtml: string, generation: string): string {
  return `(function(){
  var written = ${encodeForInlineScript(writtenHtml)};
  var generation = ${encodeForInlineScript(generation)};
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== '${SRCDOC_STREAM_MESSAGE_TYPE}' || typeof data.html !== 'string') return;
    if (typeof data.generation !== 'string' || data.generation !== generation) return;
    if (data.html === written) {
      if (data.done) document.close();
      return;
    }
    if (data.html.length > written.length && data.html.slice(0, written.length) === written) {
      document.write(data.html.slice(written.length));
      written = data.html;
    } else {
      document.open();
      document.write(data.html);
      written = data.html;
    }
    if (data.done) document.close();
  });
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: '${SRCDOC_STREAM_READY_TYPE}', generation: generation }, '*');
    }
  } catch (_) {}
})();`;
}

/**
 * Inner script for the lazy transport shell. First stream message
 * open+writes (no close). Later messages are handled by the injected bridge
 * after this document is replaced. Activate keeps the historical rewrite path.
 */
export function buildLiveHtmlStreamShellScript(): string {
  return `(function(){
  function injectStreamBridge(html, generation) {
    var writtenJson = JSON.stringify(html).replace(/</g, '\\\\u003c');
    var genJson = JSON.stringify(generation).replace(/</g, '\\\\u003c');
    var bridge = '<script data-od-srcdoc-stream-bridge>(function(){'
      + 'var written=' + writtenJson + ';'
      + 'var generation=' + genJson + ';'
      + 'window.addEventListener("message",function(ev){'
      + 'var data=ev&&ev.data;'
      + 'if(!data||data.type!=="${SRCDOC_STREAM_MESSAGE_TYPE}"||typeof data.html!=="string")return;'
      + 'if(typeof data.generation!=="string"||data.generation!==generation)return;'
      + 'if(data.html===written){if(data.done)document.close();return;}'
      + 'if(data.html.length>written.length&&data.html.slice(0,written.length)===written){'
      + 'document.write(data.html.slice(written.length));written=data.html;'
      + '}else{document.open();document.write(data.html);written=data.html;}'
      + 'if(data.done)document.close();'
      + '});'
      + 'try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:"${SRCDOC_STREAM_READY_TYPE}",generation:generation},"*");}catch(e){}'
      + '})();<' + '/script>';
    var match = html.match(/<head[^>]*>/i);
    if (match) {
      var at = match.index + match[0].length;
      return html.slice(0, at) + bridge + html.slice(at);
    }
    match = html.match(/<html[^>]*>/i);
    if (match) {
      var at = match.index + match[0].length;
      return html.slice(0, at) + '<head>' + bridge + '</head>' + html.slice(at);
    }
    return bridge + html;
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data) return;
    if (data.type === '${SRCDOC_STREAM_MESSAGE_TYPE}' && typeof data.html === 'string' && typeof data.generation === 'string' && data.generation) {
      document.open();
      document.write(injectStreamBridge(data.html, data.generation));
      if (data.done) document.close();
      return;
    }
    if (data.type !== 'od:srcdoc-transport-activate' || typeof data.html !== 'string' || typeof data.generation !== 'string' || !data.generation) return;
    document.open();
    document.write(data.html);
    document.close();
  });
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'od:srcdoc-transport-ready' }, '*');
    }
  } catch (_) {}
})();`;
}
