import { describe, expect, it, vi } from 'vitest';

import { registerClient } from '../src/mcp-oauth.js';

describe('registerClient', () => {
  it('registers as ACP Design on third-party OAuth consent screens', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { client_name?: string };
      expect(body.client_name).toBe('ACP Design');
      expect(body.client_name).not.toBe('OpenDesign');
      return new Response(JSON.stringify({ client_id: 'cid_1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await expect(
      registerClient('https://auth.example/register', 'http://127.0.0.1/callback', fetchImpl),
    ).resolves.toEqual({ clientId: 'cid_1' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
