import { describe, expect, it } from 'vitest';

import { grokBuildAgentDef } from '../../src/runtimes/defs/grok-build.js';

describe('grok-build runtime', () => {
  it('captures its CLI session id from the stream and stays text_artifact', () => {
    expect(grokBuildAgentDef.capturesSessionIdFromStream).toBe(true);
    expect(grokBuildAgentDef.executionProfile).toBe('text_artifact');
    expect(grokBuildAgentDef.streamFormat).toBe('json-event-stream');
    expect(grokBuildAgentDef.authProbe).toEqual({
      args: ['models'],
      timeoutMs: 10_000,
    });
  });
});
