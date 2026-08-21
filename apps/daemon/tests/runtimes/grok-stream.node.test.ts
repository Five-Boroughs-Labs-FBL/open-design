import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.ts';
import { buildGrokHeadlessArgs } from '../../src/runtimes/grok-args.ts';
import { createArtifactParser } from '../../../web/src/artifacts/parser.ts'; // shipped web parser

const here = dirname(fileURLToPath(import.meta.url));

test('grok-build streams ACP json, not persist-on-success plain', () => {
  const def = readFileSync(
    join(here, '../../src/runtimes/defs/grok-build.ts'),
    'utf8',
  );
  assert.match(def, /streamFormat: 'json-event-stream'/);
  assert.match(def, /eventParser: 'grok'/);
  assert.doesNotMatch(def, /streamFormat: 'plain'/);
  const args = buildGrokHeadlessArgs({
    promptFilePath: '/tmp/od-grok-prompt/prompt.md',
    model: 'grok-4.3',
  });
  assert.equal(args.includes('--output-format'), true);
  assert.equal(args[args.indexOf('--output-format') + 1], 'streaming-json');
});

test('grok streaming-json paints artifact HTML before the run end event', () => {
  /** @type {Record<string, unknown>[]} */
  const streamEvents = [];
  const handler = createJsonEventStreamHandler('grok', (event) => streamEvents.push(event));
  const parser = createArtifactParser();
  /** @type {Array<{ type: string }>} */
  const previewEvents = [];
  let drained = 0;
  const drain = () => {
    for (; drained < streamEvents.length; drained += 1) {
      const event = streamEvents[drained];
      if (event.type === 'text_delta' && typeof event.delta === 'string') {
        for (const preview of parser.feed(event.delta)) previewEvents.push(preview);
      }
    }
  };

  handler.feed(
    '{"type":"thought","data":"draw"}\n' +
    '{"type":"text","data":"<artifact identifier=\\"primary\\" type=\\"text/html\\" title=\\"HUD\\">"}\n' +
    '{"type":"text","data":"<!doctype html><html><body><header>Radio</header>"}\n',
  );
  drain();

  assert.equal(streamEvents.some((event) => event.type === 'thinking_delta'), true);
  assert.ok(previewEvents.find((event) => event.type === 'artifact:start'));
  assert.ok(previewEvents.find((event) => event.type === 'artifact:chunk'));
  assert.equal(
    previewEvents.some((event) => event.type === 'artifact:end'),
    false,
    'preview must update before </artifact> / process exit',
  );
  assert.equal(streamEvents.some((event) => event.type === 'status'), false);

  const beforeEnd = previewEvents.length;
  handler.feed(
    '{"type":"text","data":"</body></html></artifact>"}\n' +
    '{"type":"end","stopReason":"end_turn","sessionId":"sess-live"}\n',
  );
  handler.flush();
  drain();

  assert.ok(beforeEnd > 0);
  assert.ok(previewEvents.find((event) => event.type === 'artifact:end'));
  const complete = streamEvents.find((event) => event.type === 'status');
  assert.equal(complete && complete.sessionId, 'sess-live');
});
