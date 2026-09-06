import { describe, expect, it } from 'vitest';

import {
  shouldRunMinimaxHttpFallback,
  streamMinimaxHttpTurn,
} from '../../src/runtimes/minimax-http.ts';

describe('shouldRunMinimaxHttpFallback', () => {
  const minimax = {
    apiKey: 'sk-admin-minimax',
    baseUrl: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M2.7-highspeed',
  };

  it('uses MiniMax HTTP only when OpenCode is missing and the key is MiniMax', () => {
    expect(shouldRunMinimaxHttpFallback({
      agentId: 'byok-opencode',
      provider: minimax,
      hasResolvedBin: false,
    })).toBe(true);
    expect(shouldRunMinimaxHttpFallback({
      agentId: 'byok-opencode',
      provider: minimax,
      hasResolvedBin: true,
    })).toBe(false);
    expect(shouldRunMinimaxHttpFallback({
      agentId: 'byok-opencode',
      provider: { ...minimax, apiKey: '' },
      hasResolvedBin: false,
    })).toBe(false);
    expect(shouldRunMinimaxHttpFallback({
      agentId: 'byok-opencode',
      provider: {
        apiKey: 'sk-ant',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-opus-4',
      },
      hasResolvedBin: false,
    })).toBe(false);
  });
});

describe('streamMinimaxHttpTurn', () => {
  it('posts to MiniMax Messages and forwards text deltas', async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    const deltas: string[] = [];
    await streamMinimaxHttpTurn({
      apiKey: 'sk-admin-minimax',
      baseUrl: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M2.7-highspeed',
      prompt: 'hi',
      onDelta: (text) => deltas.push(text),
      fetchImpl: async (url, init) => {
        seen.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body ?? '{}')),
        });
        return sseResponse([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]);
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(seen[0]?.headers.get('x-api-key')).toBe('sk-admin-minimax');
    expect(seen[0]?.body).toEqual({
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 8192,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(deltas).toEqual(['hello', ' there']);
  });

  it('surfaces a MiniMax HTTP error instead of asking for OpenCode', async () => {
    await expect(streamMinimaxHttpTurn({
      apiKey: 'sk-admin-minimax',
      baseUrl: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M2.7-highspeed',
      prompt: 'hi',
      onDelta: () => {},
      fetchImpl: async () => new Response('invalid key', { status: 401 }),
    })).rejects.toThrow(/MiniMax returned 401/);
  });
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index]));
          index += 1;
          return;
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}
