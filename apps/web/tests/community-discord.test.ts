import { describe, expect, it } from 'vitest';

import { ACP_DISCORD_INVITE_CODE, ACP_DISCORD_INVITE_URL } from '@open-design/contracts';
import { SUPPORT_DISCORD_URL } from '../src/components/chat/support-channels';

describe('shipped Discord invite', () => {
  it('uses the ACP community invite from contracts in UI support channels', () => {
    expect(ACP_DISCORD_INVITE_CODE).toBe('jE4MzArHX');
    expect(ACP_DISCORD_INVITE_URL).toBe('https://discord.gg/jE4MzArHX');
    expect(SUPPORT_DISCORD_URL).toBe(ACP_DISCORD_INVITE_URL);
    expect(SUPPORT_DISCORD_URL).not.toContain('mHAjSMV6gz');
    expect(SUPPORT_DISCORD_URL).not.toContain('qhbcCH8Am4');
  });
});
