import { afterEach, expect, it, vi } from 'vitest';
import { fetchCurrentAcpDesignExecution } from '../../src/runtimes/acp-design-execution.js';

afterEach(() => vi.restoreAllMocks());

const env = { OD_ACP_BE_URL: 'http://127.0.0.1:8080', OD_API_TOKEN: 'service-token' };
const authJson = '{"auth_mode":"chatgpt","tokens":{"access_token":"test"}}';

it('accepts a Codex Design choice and its matching credential for Studio follow-ups', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    agentId: 'codex', model: 'gpt-6-sol', reasoning: 'high',
    amcCredential: { family: 'codex', env: { CODEX_AUTH_JSON: authJson } },
  }), { status: 200 }));
  const execution = await fetchCurrentAcpDesignExecution('frun-test', 'project-test', 'user-test', true, env);
  expect(execution).toEqual({
    agentId: 'codex', model: 'gpt-6-sol', reasoning: 'high',
    amcCredential: { family: 'codex', env: { CODEX_AUTH_JSON: authJson } },
  });
  const [requestUrl, options] = fetchMock.mock.calls[0]!;
  expect(String(requestUrl)).toContain('credentials=1');
  expect(options?.headers).toEqual({ authorization: 'Bearer service-token', 'cache-control': 'no-store' });
});

it('refuses a Codex turn with another provider\'s credential', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    agentId: 'codex', model: 'gpt-6-sol', reasoning: null,
    amcCredential: { family: 'muse', env: { META_API_KEY: 'wrong-account' } },
  }), { status: 200 }));
  await expect(fetchCurrentAcpDesignExecution('frun-test', 'project-test', 'user-test', true, env))
    .rejects.toThrow('does not match');
});
