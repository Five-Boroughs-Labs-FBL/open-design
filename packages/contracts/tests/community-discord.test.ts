import { describe, expect, it } from 'vitest';

import { ACP_DISCORD_INVITE_CODE, ACP_DISCORD_INVITE_URL } from '../src/api/community.js';

describe('ACP community Discord invite', () => {
  it('is the shipped invite code and URL', () => {
    expect(ACP_DISCORD_INVITE_CODE).toBe('jE4MzArHX');
    expect(ACP_DISCORD_INVITE_URL).toBe('https://discord.gg/jE4MzArHX');
    expect(ACP_DISCORD_INVITE_CODE).not.toBe('mHAjSMV6gz');
    expect(ACP_DISCORD_INVITE_URL).not.toContain('mHAjSMV6gz');
    expect(ACP_DISCORD_INVITE_URL).not.toContain('qhbcCH8Am4');
  });
});
