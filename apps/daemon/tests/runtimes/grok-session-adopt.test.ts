import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  adoptGrokSession,
  grokSessionDirForTest,
} from '../../src/runtimes/grok-session-adopt.ts';
import { applyAmcGrokHome, parseAmcGrokBlock } from '../../src/runtimes/amc-grok.ts';

describe('adoptGrokSession', () => {
  it('copies a session dir from the planner cwd key to the OD project cwd key', () => {
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
    expect(result.copied).toBe(true);
    expect(result.targetDir).toBe(grokSessionDirForTest(home, targetCwd, sessionId));
    const again = adoptGrokSession({
      grokHome: home,
      sessionId,
      sourceCwd,
      targetCwd,
    });
    expect(again.copied).toBe(false);
  });

  it('fails closed when the session id is missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'od-grok-home-missing-'));
    expect(() =>
      adoptGrokSession({
        grokHome: home,
        sessionId: 'no-such-session',
        sourceCwd: '/amc/src',
        targetCwd: '/od/dst',
      }),
    ).toThrow(/session_transcript_missing/);
  });
});

describe('parseAmcGrokBlock', () => {
  it('requires an existing grokHome directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'od-amc-grok-'));
    const parsed = parseAmcGrokBlock({
      sessionId: 'sess-1',
      grokHome: home,
      sourceCwd: '/amc/src',
    });
    expect(parsed).toEqual({
      sessionId: 'sess-1',
      grokHome: home,
      sourceCwd: '/amc/src',
    });
    expect(() =>
      parseAmcGrokBlock({ sessionId: 'sess-1', grokHome: join(home, 'missing') }),
    ).toThrow(/grok_home_unreachable/);
    const loginOnly = parseAmcGrokBlock({ grokHome: home });
    expect(loginOnly?.sessionId).toBe('');
    expect(loginOnly?.grokHome).toBe(home);
  });

  it('accepts an AMC API key when grokHome is not on this host', () => {
    const parsed = parseAmcGrokBlock({
      grokHome: '/app/data/cred-runtime/admin/.grok',
      apiKey: 'xai-from-amc',
    });
    expect(parsed?.apiKey).toBe('xai-from-amc');
  });

  it('applies GROK_HOME onto spawn env and ignores empty blocks', () => {
    expect(parseAmcGrokBlock(null)).toBe(null);
    const env = applyAmcGrokHome({ PATH: '/bin' }, {
      sessionId: 's',
      grokHome: '/grok-home',
      sourceCwd: '',
    });
    expect(env.GROK_HOME).toBe('/grok-home');
    expect(env.PATH).toBe('/bin');
  });
});
