import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGrokHeadlessArgs } from '../../src/runtimes/grok-args.ts';
import {
  adoptGrokSession,
  grokSessionDirForTest,
} from '../../src/runtimes/grok-session-adopt.ts';
import { applyAmcGrokHome, parseAmcGrokBlock } from '../../src/runtimes/amc-grok.ts';

test('buildGrokHeadlessArgs resumes an AMC session id via --resume and still uses --prompt-file', () => {
  const promptFilePath = '/tmp/od-grok-prompt/prompt.md';
  const args = buildGrokHeadlessArgs({
    promptFilePath,
    resumeSessionId: 'session-from-amc',
    model: 'grok-4.3',
  });
  assert.ok(args.includes('--resume'));
  assert.equal(args[args.indexOf('--resume') + 1], 'session-from-amc');
  assert.equal(args[0], '--prompt-file');
  assert.equal(args.includes('-p'), false);
  const fresh = buildGrokHeadlessArgs({ promptFilePath, model: 'grok-4.3' });
  assert.equal(fresh.includes('--resume'), false);
});

test('adoptGrokSession copies planner cwd key to OD cwd key', () => {
  const home = mkdtempSync(join(tmpdir(), 'od-grok-home-'));
  const sourceCwd = '/amc/worktrees/proj';
  const targetCwd = '/od/projects/amc-design';
  const sessionId = 'planner-session-1';
  const sourceDir = grokSessionDirForTest(home, sourceCwd, sessionId);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'chat_history.jsonl'), '{"ok":true}\n');
  const result = adoptGrokSession({
    grokHome: home,
    sessionId,
    sourceCwd,
    targetCwd,
  });
  assert.equal(result.copied, true);
  const again = adoptGrokSession({
    grokHome: home,
    sessionId,
    sourceCwd,
    targetCwd,
  });
  assert.equal(again.copied, false);
});

test('adoptGrokSession fails closed when the session id is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'od-grok-home-missing-'));
  assert.throws(
    () =>
      adoptGrokSession({
        grokHome: home,
        sessionId: 'no-such-session',
        sourceCwd: '/amc/src',
        targetCwd: '/od/dst',
      }),
    /session_transcript_missing/,
  );
});

test('parseAmcGrokBlock requires an existing grokHome directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'od-amc-grok-'));
  const parsed = parseAmcGrokBlock({
    sessionId: 'sess-1',
    grokHome: home,
    sourceCwd: '/amc/src',
  });
  assert.deepEqual(parsed, {
    sessionId: 'sess-1',
    grokHome: home,
    sourceCwd: '/amc/src',
  });
  assert.throws(
    () => parseAmcGrokBlock({ sessionId: 'sess-1', grokHome: join(home, 'missing') }),
    /grok_home_unreachable/,
  );
  const loginOnly = parseAmcGrokBlock({ grokHome: home });
  assert.equal(loginOnly.sessionId, '');
});

test('applyAmcGrokHome sets GROK_HOME on spawn env', () => {
  const env = applyAmcGrokHome(
    { PATH: '/bin' },
    { sessionId: 's', grokHome: '/grok-home', sourceCwd: '' },
  );
  assert.equal(env.GROK_HOME, '/grok-home');
  assert.equal(env.PATH, '/bin');
});
