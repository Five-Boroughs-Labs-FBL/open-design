import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  amcCredentialMatchesAgent,
  applyAmcCredential,
  materializeAmcCredential,
  parseAmcCredentialBlock,
  readAmcCredentialFile,
  supportedAmcCredentialFamilies,
} from '../../src/runtimes/amc-credential.ts';

const CURSOR = { family: 'cursor', env: { CURSOR_API_KEY: 'key-123' } };

describe('parseAmcCredentialBlock', () => {
  it('returns null when absent', () => {
    expect(parseAmcCredentialBlock(null)).toBeNull();
    expect(parseAmcCredentialBlock(undefined)).toBeNull();
  });

  it('accepts an allowlisted cursor credential', () => {
    expect(parseAmcCredentialBlock(CURSOR)).toEqual(CURSOR);
  });

  it('lowercases and trims the family', () => {
    expect(parseAmcCredentialBlock({ family: ' Cursor ', env: { CURSOR_API_KEY: 'k' } }))
      .toEqual({ family: 'cursor', env: { CURSOR_API_KEY: 'k' } });
  });

  it('rejects a family this build does not support', () => {
    expect(() => parseAmcCredentialBlock({ family: 'claude', env: { ANTHROPIC_API_KEY: 'k' } }))
      .toThrow(/not supported/);
  });

  // The whole point of the allowlist: a caller cannot name the variable.
  it('rejects an env key outside the family allowlist', () => {
    expect(() => parseAmcCredentialBlock({ family: 'cursor', env: { PATH: '/evil' } }))
      .toThrow(/not allowed/);
    expect(() =>
      parseAmcCredentialBlock({
        family: 'cursor',
        env: { CURSOR_API_KEY: 'k', NODE_OPTIONS: '--require=/evil' },
      }),
    ).toThrow(/not allowed/);
  });

  it('rejects a non-string value', () => {
    expect(() => parseAmcCredentialBlock({ family: 'cursor', env: { CURSOR_API_KEY: 5 } }))
      .toThrow(/must be a string/);
  });

  it('rejects an oversized value', () => {
    const huge = 'x'.repeat(8_193);
    expect(() => parseAmcCredentialBlock({ family: 'cursor', env: { CURSOR_API_KEY: huge } }))
      .toThrow(/too large/);
  });

  // An empty envelope would fall through to the daemon's ambient environment
  // and bill whoever that belongs to, so it is refused rather than ignored.
  it('refuses an envelope that carries nothing', () => {
    expect(() => parseAmcCredentialBlock({ family: 'cursor', env: { CURSOR_API_KEY: '  ' } }))
      .toThrow(/carried no credential values/);
  });

  it('rejects a malformed block', () => {
    expect(() => parseAmcCredentialBlock('nope')).toThrow(/must be an object/);
    expect(() => parseAmcCredentialBlock({ env: {} })).toThrow(/requires family/);
    expect(() => parseAmcCredentialBlock({ family: 'cursor' })).toThrow(/env must be an object/);
  });
});

describe('amcCredentialMatchesAgent', () => {
  it('binds cursor to the cursor-agent runtime', () => {
    expect(amcCredentialMatchesAgent(CURSOR, 'cursor-agent')).toBe(true);
  });

  // Replaces `def.id === 'grok-build'` as the gate: a cursor key must never
  // reach a different runtime just because the caller asked for it.
  it('refuses to inject a cursor credential into another runtime', () => {
    expect(amcCredentialMatchesAgent(CURSOR, 'grok-build')).toBe(false);
    expect(amcCredentialMatchesAgent(CURSOR, 'claude')).toBe(false);
  });

  it('is false for no credential', () => {
    expect(amcCredentialMatchesAgent(null, 'cursor-agent')).toBe(false);
  });
});

describe('applyAmcCredential', () => {
  it('adds the credential to the spawn env for a matching agent', () => {
    const env = applyAmcCredential({ PATH: '/bin' }, CURSOR, 'cursor-agent');
    expect(env.CURSOR_API_KEY).toBe('key-123');
    expect(env.PATH).toBe('/bin');
  });

  // An ambient key on the OD host must not decide which account a run bills.
  it('overrides an ambient host key', () => {
    const env = applyAmcCredential({ CURSOR_API_KEY: 'host-key' }, CURSOR, 'cursor-agent');
    expect(env.CURSOR_API_KEY).toBe('key-123');
  });

  it('is a no-op for a non-matching agent', () => {
    const env = applyAmcCredential({ PATH: '/bin' }, CURSOR, 'grok-build');
    expect(env.CURSOR_API_KEY).toBeUndefined();
  });

  it('is a no-op with no credential', () => {
    expect(applyAmcCredential({ PATH: '/bin' }, null, 'cursor-agent')).toEqual({ PATH: '/bin' });
  });
});

describe('credential persistence for studio follow-ups', () => {
  it('round-trips through a 0600 file and re-validates on read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-amc-cred-'));
    const file = materializeAmcCredential(dir, CURSOR);

    // The secret lives on disk, never in the database — only the path is
    // recorded in project metadata.
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(CURSOR);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readAmcCredentialFile(file)).toEqual(CURSOR);
  });

  it('returns null for a missing or relative path', () => {
    expect(readAmcCredentialFile('')).toBeNull();
    expect(readAmcCredentialFile('relative/path.json')).toBeNull();
    expect(readAmcCredentialFile(join(tmpdir(), 'od-does-not-exist.json'))).toBeNull();
  });

  it('requires an absolute data dir', () => {
    expect(() => materializeAmcCredential('relative', CURSOR)).toThrow(/absolute dataDir/);
  });
});

describe('supportedAmcCredentialFamilies', () => {
  it('reports what this build accepts', () => {
    expect(supportedAmcCredentialFamilies()).toContain('cursor');
  });
});
