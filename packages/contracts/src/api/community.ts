/** Community Discord invite shown in UI, desktop Help, daemon presence, and docs. */
export const ACP_DISCORD_INVITE_CODE = 'jE4MzArHX';
export const ACP_DISCORD_INVITE_URL = `https://discord.gg/${ACP_DISCORD_INVITE_CODE}`;

export interface OpenDesignDiscordPresenceResponse {
  inviteCode: string;
  inviteUrl: string;
  onlineCount: number;
  memberCount: number;
  fetchedAt: number;
  stale: boolean;
}
