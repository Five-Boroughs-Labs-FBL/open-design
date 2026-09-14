import { describe, expect, it } from 'vitest';

import { renderSlimCoreCharter } from '../../src/prompts/core-slim.js';
import { renderOfficialDesignerPrompt } from '../../src/prompts/official-system.js';
import { renderDiscoveryAndPhilosophy } from '../../src/prompts/discovery.js';
import { resolveExecutionProfile } from '@open-design/contracts';

import { grokBuildAgentDef } from '../../src/runtimes/defs/grok-build.js';

describe('grok-build runtime', () => {
  it('selects file delivery in slim and classic prompts for first runs and edits', () => {
    const profile = resolveExecutionProfile(grokBuildAgentDef.streamFormat, grokBuildAgentDef.executionProfile);
    expect(profile).toBe('filesystem');
    for (const claimedDesignSurfaceCount of [1, 10]) {
      const options = { streamFormat: grokBuildAgentDef.streamFormat, claimedDesignSurfaceCount };
      for (const render of [renderSlimCoreCharter, renderOfficialDesignerPrompt, renderDiscoveryAndPhilosophy]) {
        const prompt = render(profile, options);
        expect(prompt).not.toContain('no filesystem tools');
        expect(prompt).not.toContain('re-stream');
        expect(prompt).not.toContain('live-paints');
        expect(prompt).not.toContain('Stream the first claimed surface');
      }
      expect(renderSlimCoreCharter(profile, options)).toContain('Project files are the source of truth');
    }
  });

  it('streams chat updates while delivering designs through files', () => {
    expect(grokBuildAgentDef.capturesSessionIdFromStream).toBe(true);
    expect(grokBuildAgentDef.executionProfile).toBe('filesystem');
    expect(grokBuildAgentDef.streamFormat).toBe('json-event-stream');
    expect(grokBuildAgentDef.authProbe).toEqual({
      args: ['models'],
      timeoutMs: 10_000,
    });
  });
});
