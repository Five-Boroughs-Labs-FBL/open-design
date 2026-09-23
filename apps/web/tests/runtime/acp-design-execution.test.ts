import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/state/config';
import { applyAcpDesignExecution, readAcpDesignExecution } from '../../src/runtime/acp-design-execution';

afterEach(() => vi.unstubAllGlobals());

describe('ACP Design execution', () => {
  const muse = { agentId: 'muse', model: 'muse-spark-1.2-contributor', reasoning: 'high' };

  it.each(['api', 'daemon'] as const)('overrides a %s studio default with the exact Muse handoff', (mode) => {
    const original = { ...DEFAULT_CONFIG, mode, agentId: 'grok-build', agentModels: {
      'grok-build': { model: 'grok-4.6', reasoning: 'xhigh' },
      muse: { model: 'other-muse-model', reasoning: 'low', serviceTier: 'fast' },
    } };
    const result = applyAcpDesignExecution(original, muse);
    expect(result.mode).toBe('daemon');
    expect(result.agentId).toBe('muse');
    expect(result.agentModels?.muse).toEqual({ model: muse.model, reasoning: 'high' });
    expect(original.agentId).toBe('grok-build');
  });

  it('does not infer the runtime from a vendor model name', () => {
    const result = applyAcpDesignExecution(DEFAULT_CONFIG, {
      agentId: 'cursor-agent', model: 'grok-4.6', reasoning: null,
    });
    expect(result.agentId).toBe('cursor-agent');
    expect(result.agentModels?.['cursor-agent']).toEqual({ model: 'grok-4.6' });
  });

  it('reads the scoped selection without caching it across projects', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => muse });
    vi.stubGlobal('fetch', fetcher);
    expect(await readAcpDesignExecution('project/a', 'conversation/b')).toEqual(muse);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/projects/project%2Fa/conversations/conversation%2Fb/acp-design-execution',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it.each([null, {}, { agentId: 'muse', model: '' }, { agentId: 1, model: 'muse' }])(
    'fails closed for an invalid selection: %j', async (value) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => value }));
      await expect(readAcpDesignExecution('p', 'c')).rejects.toThrow('selection is unavailable');
    },
  );

  it('fails closed when the authority read fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(readAcpDesignExecution('p', 'c')).rejects.toThrow('selected ACP Design model');
  });
});
