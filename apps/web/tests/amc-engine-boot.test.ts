/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { isAmcEngineBoot } from '../src/amc-engine-boot';
import { isAmcEmbedActive } from '../src/amc-embed';
import { listProjects } from '../src/state/projects';

describe('amc engine boot', () => {
  afterEach(() => {
    delete (window as Window & { __OD_AMC_ENGINE__?: boolean }).__OD_AMC_ENGINE__;
    delete document.documentElement.dataset.odAmcEngine;
    delete document.documentElement.dataset.amcEmbed;
  });

  it('treats the injected marker as engine + embed chrome', () => {
    expect(isAmcEngineBoot()).toBe(false);
    (window as Window & { __OD_AMC_ENGINE__?: boolean }).__OD_AMC_ENGINE__ = true;
    expect(isAmcEngineBoot()).toBe(true);
    expect(isAmcEmbedActive()).toBe(true);
  });

  it('does not call GET /api/projects in engine mode', async () => {
    (window as Window & { __OD_AMC_ENGINE__?: boolean }).__OD_AMC_ENGINE__ = true;
    const orig = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ projects: [{ id: 'leaked' }] }), { status: 200 });
    }) as typeof fetch;
    try {
      await expect(listProjects()).resolves.toEqual([]);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
