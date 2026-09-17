import { describe, expect, it } from 'vitest';

import { applyAmcCredential, parseAmcCredentialBlock } from '../../src/runtimes/amc-credential.ts';
import { museAgentDef, buildMuseHeadlessArgs } from '../../src/runtimes/defs/muse.ts';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.ts';
import { getAgentDef } from '../../src/runtimes/registry.ts';

const MUSE = { family: 'muse', env: { META_API_KEY: 'meta-key-abcdefghijklmnopqrst' } };

describe('muse Open Design agent', () => {
  it('is a shipped agent with the AMC Design agentId', () => {
    expect(getAgentDef('muse')).toBe(museAgentDef);
    expect(museAgentDef.id).toBe('muse');
    expect(museAgentDef.bin).toBe('muse');
    expect(museAgentDef.eventParser).toBe('muse');
    expect(museAgentDef.promptViaFile).toBe(true);
    expect(museAgentDef.executionProfile).toBe('text_artifact');
  });

  it('builds headless exec args from a prompt file', () => {
    const args = buildMuseHeadlessArgs({
      promptFilePath: '/tmp/od-muse/prompt.md',
      model: 'muse-spark-1.3',
      reasoning: 'high',
      resumeSessionId: 'sess-1',
    });
    expect(args).toEqual([
      'exec',
      '--json',
      '--approval-mode',
      'never',
      '--trust-workspace',
      '--disable-sandbox',
      '--prompt-file',
      '/tmp/od-muse/prompt.md',
      '--model',
      'muse-spark-1.2-contributor',
      '--reasoning-effort',
      'high',
      '--session-id',
      'sess-1',
    ]);
  });

  it('pins Spark 1.2 contributor when the model is omitted, 1.2, 1.3, or leftover 1.3 contributor', () => {
    const omitted = buildMuseHeadlessArgs({ promptFilePath: '/tmp/od-muse/prompt.md' });
    expect(omitted[omitted.indexOf('--model') + 1]).toBe('muse-spark-1.2-contributor');
    const remapped = buildMuseHeadlessArgs({
      promptFilePath: '/tmp/od-muse/prompt.md',
      model: 'muse-spark-1.3-contributor',
    });
    expect(remapped[remapped.indexOf('--model') + 1]).toBe('muse-spark-1.2-contributor');
    const spark13 = buildMuseHeadlessArgs({
      promptFilePath: '/tmp/od-muse/prompt.md',
      model: 'muse-spark-1.3',
    });
    expect(spark13[spark13.indexOf('--model') + 1]).toBe('muse-spark-1.2-contributor');
    const spark12 = buildMuseHeadlessArgs({
      promptFilePath: '/tmp/od-muse/prompt.md',
      model: 'muse-spark-1.2',
    });
    expect(spark12[spark12.indexOf('--model') + 1]).toBe('muse-spark-1.2-contributor');
  });

  it('refuses to embed the prompt when the daemon omitted the file', () => {
    expect(() => buildMuseHeadlessArgs({ promptFilePath: '' })).toThrow(/promptFilePath/);
  });
});

describe('muse AMC credential', () => {
  it('accepts META_API_KEY and binds it only to the muse agent', () => {
    expect(parseAmcCredentialBlock(MUSE)).toEqual(MUSE);
    const env = applyAmcCredential({ PATH: '/bin' }, MUSE, 'muse');
    expect(env.META_API_KEY).toBe('meta-key-abcdefghijklmnopqrst');
    const skipped = applyAmcCredential({ PATH: '/bin' }, MUSE, 'grok-build');
    expect(skipped.META_API_KEY).toBeUndefined();
  });

  it('rejects a PATH injection on the muse family', () => {
    expect(() => parseAmcCredentialBlock({ family: 'muse', env: { PATH: '/evil' } }))
      .toThrow(/not allowed/);
  });
});

describe('muse JSONL stream', () => {
  it('emits session + text from live Muse payload_types', () => {
    const events: Array<Record<string, unknown>> = [];
    const handler = createJsonEventStreamHandler('muse', (event) => events.push(event));
    handler.feed(`${JSON.stringify({
      stream: { kind: 'session', id: 'sess-muse' },
      payload_type: 'run.model.configured',
      payload: { model_id: 'muse-spark-1.3' },
    })}\n`);
    handler.feed(`${JSON.stringify({
      stream: { kind: 'session', id: 'sess-muse' },
      payload_type: 'run.output.delta',
      payload: { text: 'hello' },
    })}\n`);
    handler.feed(`${JSON.stringify({
      stream: { kind: 'session', id: 'sess-muse' },
      payload_type: 'run.terminal.completed',
      payload: { text: 'PONG', terminal: 'completed' },
    })}\n`);
    handler.flush();

    expect(events.some((event) => event.type === 'status' && event.sessionId === 'sess-muse')).toBe(true);
    const text = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => event.delta)
      .join('');
    expect(text).toContain('hello');
    expect(text).toContain('PONG');
  });

  it('does not parse Muse JSONL as Grok', () => {
    const events: Array<Record<string, unknown>> = [];
    const handler = createJsonEventStreamHandler('grok', (event) => events.push(event));
    handler.feed(`${JSON.stringify({
      stream: { kind: 'session', id: 'sess-muse' },
      payload_type: 'run.output.delta',
      payload: { text: 'hello' },
    })}\n`);
    handler.flush();
    expect(events.some((event) => event.type === 'text_delta')).toBe(false);
  });
});
