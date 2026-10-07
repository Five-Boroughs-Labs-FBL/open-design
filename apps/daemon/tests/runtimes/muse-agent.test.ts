import { describe, expect, it } from 'vitest';

import { applyAmcCredential, parseAmcCredentialBlock } from '../../src/runtimes/amc-credential.js';
import { museAgentDef, buildMuseHeadlessArgs } from '../../src/runtimes/defs/muse.js';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';
import { getAgentDef } from '../../src/runtimes/registry.js';

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

  it('forwards every reference image as a separate CLI argument on new and resumed turns', () => {
    const images = ['/project/uploads/map reference.png', 'C:\\design files\\second.png'];
    for (const resumeSessionId of [undefined, 'existing-session']) {
      const args = museAgentDef.buildArgs('Edit this map', images, [], {}, {
        promptFilePath: '/project/prompt.md',
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
      expect(args.slice(-4)).toEqual(['--image', images[0], '--image', images[1]]);
    }
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
  function replay(frames: Array<{ payload_type: string; payload: Record<string, unknown> }>) {
    const events: Array<Record<string, unknown>> = [];
    const handler = createJsonEventStreamHandler('muse', (event) => events.push(event));
    const wire = frames.map((frame) => JSON.stringify({
      stream: { kind: 'session', id: 'sess-muse' }, ...frame,
    })).join('\n');
    // Exercise chunk framing and a final record without a trailing newline.
    for (let offset = 0; offset < wire.length; offset += 17) handler.feed(wire.slice(offset, offset + 17));
    handler.flush();
    return events;
  }

  it.each(['task.rejected', 'task.failed', 'tool.error', 'run.model.error', 'agent.message.rejected'])(
    'does not turn a recoverable %s event into a fatal run error',
    (payload_type) => {
      // Synthetic wire replay: the incident's native trace recorded a skipped
      // reminder and successful completion, but did not retain exec stdout.
      const events = replay([
        { payload_type, payload: { reason: 'skip_if_running' } },
        { payload_type: 'run.output.delta', payload: { text: 'Created the requested screens.' } },
        { payload_type: 'run.terminal.completed', payload: { text: 'Design complete.' } },
      ]);
      expect(events.filter((event) => event.type === 'error')).toEqual([]);
      expect(events).toContainEqual({ type: 'status', label: 'warning', detail: 'skip_if_running' });
      expect(events).toContainEqual({ type: 'text_delta', delta: 'Design complete.' });
      expect(events.filter((event) => event.label === 'session')).toHaveLength(1);
      expect(events).toContainEqual({ type: 'status', label: 'complete', sessionId: 'sess-muse' });
    },
  );

  it.each(['run.terminal.failed', 'run.terminal.error', 'run.terminal.rejected', 'run.failed', 'run.error', 'run.rejected', 'error', 'stream.error'])(
    'keeps %s fatal even when completion or useful output follows',
    (payload_type) => {
      const events = replay([
        { payload_type: 'run.output.delta', payload: { text: 'Partial output before failure' } },
        { payload_type, payload: { error: { message: 'Provider quota exhausted' } } },
        { payload_type: 'run.terminal.completed', payload: { text: 'Partial result' } },
      ]);
      expect(events.filter((event) => event.type === 'error')).toEqual([
        { type: 'error', message: 'Provider quota exhausted' },
      ]);
    },
  );

  it('retains a terminal failure after output and uses a useful fallback', () => {
    expect(replay([
      { payload_type: 'run.terminal.completed', payload: { text: 'Partial result' } },
      { payload_type: 'run.terminal.failed', payload: {} },
    ])).toContainEqual({ type: 'error', message: 'Muse stream error' });
  });

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

    const sessionEvents = events.filter(
      (event) => event.type === 'status' && event.label === 'session',
    );
    expect(sessionEvents).toEqual([
      { type: 'status', label: 'session', sessionId: 'sess-muse' },
    ]);
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
