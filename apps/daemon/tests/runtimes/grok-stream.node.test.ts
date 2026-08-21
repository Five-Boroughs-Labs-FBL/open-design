import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.ts';
import { buildGrokHeadlessArgs } from '../../src/runtimes/grok-args.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('grok-build streams ACP json, not persist-on-success plain', () => {
  const def = readFileSync(
    join(here, '../../src/runtimes/defs/grok-build.ts'),
    'utf8',
  );
  assert.match(def, /streamFormat: 'json-event-stream'/);
  assert.match(def, /eventParser: 'grok'/);
  assert.match(def, /executionProfile: 'text_artifact'/);
  assert.doesNotMatch(def, /streamFormat: 'plain'/);
  const args = buildGrokHeadlessArgs({
    promptFilePath: '/tmp/od-grok-prompt/prompt.md',
    model: 'grok-4.3',
  });
  assert.equal(args.includes('--output-format'), true);
  assert.equal(args[args.indexOf('--output-format') + 1], 'streaming-json');
});

test('grok streaming-json emits text_delta before the run end event', () => {
  /** @type {Record<string, unknown>[]} */
  const streamEvents = [];
  const handler = createJsonEventStreamHandler('grok', (event) => streamEvents.push(event));

  handler.feed(
    '{"type":"thought","data":"draw"}\n' +
    '{"type":"text","data":"<artifact identifier=\\"index\\" type=\\"text/html\\" title=\\"HUD\\">"}\n' +
    '{"type":"text","data":"<!doctype html><html><body><header>Radio</header>"}\n',
  );

  assert.equal(streamEvents.some((event) => event.type === 'thinking_delta'), true);
  const htmlBeforeEnd = streamEvents
    .filter((event) => event.type === 'text_delta')
    .map((event) => String(event.delta ?? ''))
    .join('');
  assert.match(htmlBeforeEnd, /<artifact identifier="index" type="text\/html"/);
  assert.match(htmlBeforeEnd, /<header>Radio<\/header>/);
  assert.equal(streamEvents.some((event) => event.type === 'status'), false);

  handler.feed(
    '{"type":"text","data":"</body></html></artifact>"}\n' +
    '{"type":"end","stopReason":"end_turn","sessionId":"sess-live"}\n',
  );
  handler.flush();

  const complete = streamEvents.find((event) => event.type === 'status');
  assert.equal(complete && complete.sessionId, 'sess-live');
});
