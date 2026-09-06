import { isCatalogMinimaxByok } from './catalog-minimax-auth.js';

export type MinimaxHttpProvider = {
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
};

export type StreamMinimaxHttpTurnInput = {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  fetchImpl?: typeof fetch;
};

/**
 * MiniMax Studio runs are Anthropic-compatible HTTP with a stashed admin key.
 * OpenCode is optional: when the binary is missing (hosted Studio), the daemon
 * talks to MiniMax directly instead of asking the user to install a CLI.
 */
export function shouldRunMinimaxHttpFallback(input: {
  agentId?: string | null;
  provider?: MinimaxHttpProvider | null;
  model?: unknown;
  hasResolvedBin: boolean;
}): boolean {
  if (input.hasResolvedBin) return false;
  if (input.agentId !== 'byok-opencode') return false;
  if (!isCatalogMinimaxByok(input.provider, input.model)) return false;
  return Boolean(String(input.provider?.apiKey || '').trim());
}

export async function streamMinimaxHttpTurn(input: StreamMinimaxHttpTurnInput): Promise<void> {
  const apiKey = input.apiKey.trim();
  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim();
  if (!apiKey || !baseUrl || !model) {
    throw new Error('MiniMax HTTP runs require an API key, base URL, and model');
  }
  const url = minimaxMessagesUrl(baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      messages: [{ role: 'user', content: input.prompt }],
    }),
    redirect: 'error',
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `MiniMax returned ${response.status}${errorText ? `: ${errorText.slice(0, 240)}` : ''}`,
    );
  }
  if (!response.body) {
    throw new Error('MiniMax returned an empty stream');
  }
  await readAnthropicSse(response.body, input.onDelta);
}

async function readAnthropicSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    while (true) {
      const match = buf.match(/\r?\n\r?\n/);
      if (!match || match.index === undefined) break;
      const frame = buf.slice(0, match.index);
      buf = buf.slice(match.index + match[0].length);
      event = consumeSseFrame(frame, event, onDelta);
    }
  }
  if (buf.trim()) consumeSseFrame(buf, event, onDelta);
}

function minimaxMessagesUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(pathname)
    ? `${pathname}/messages`
    : `${pathname}/v1/messages`;
  return url.toString();
}

function consumeSseFrame(
  frame: string,
  currentEvent: string,
  onDelta: (text: string) => void,
): string {
  let event = currentEvent;
  const dataLines: string[] = [];
  for (const rawLine of frame.replace(/\r/g, '').split('\n')) {
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice(6).trim();
      continue;
    }
    if (!rawLine.startsWith('data:')) continue;
    let value = rawLine.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  }
  if (dataLines.length === 0) return event;
  const raw = dataLines.join('\n');
  if (raw === '[DONE]') return event;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return event;
  }
  const type = typeof data.type === 'string' ? data.type : event;
  if (type === 'error' || event === 'error') {
    const nested = data.error;
    const message = nested && typeof nested === 'object' && 'message' in nested
      ? String((nested as { message?: unknown }).message || 'MiniMax upstream error')
      : String(data.message || 'MiniMax upstream error');
    throw new Error(message);
  }
  if (type === 'content_block_delta' || event === 'content_block_delta') {
    const delta = data.delta;
    if (delta && typeof delta === 'object' && 'text' in delta) {
      const text = (delta as { text?: unknown }).text;
      if (typeof text === 'string' && text) onDelta(text);
    }
  }
  return event;
}
