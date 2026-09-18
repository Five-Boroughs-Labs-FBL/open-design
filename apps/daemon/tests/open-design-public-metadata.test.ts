import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { ACP_DISCORD_INVITE_CODE, ACP_DISCORD_INVITE_URL } from '@open-design/contracts';
import { registerOpenDesignPublicMetadataRoutes } from '../src/routes/open-design-public-metadata.js';
import {
  OPEN_DESIGN_DISCORD_INVITE_CODE,
  OPEN_DESIGN_DISCORD_INVITE_URL,
} from '../src/services/open-design-public-metadata.js';

describe('community Discord presence', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) return;
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      closing.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('exports the ACP invite as the daemon community identity', () => {
    expect(OPEN_DESIGN_DISCORD_INVITE_CODE).toBe('jE4MzArHX');
    expect(OPEN_DESIGN_DISCORD_INVITE_URL).toBe('https://discord.gg/jE4MzArHX');
    expect(OPEN_DESIGN_DISCORD_INVITE_CODE).toBe(ACP_DISCORD_INVITE_CODE);
    expect(OPEN_DESIGN_DISCORD_INVITE_URL).toBe(ACP_DISCORD_INVITE_URL);
    expect(OPEN_DESIGN_DISCORD_INVITE_CODE).not.toBe('mHAjSMV6gz');
    expect(OPEN_DESIGN_DISCORD_INVITE_URL).not.toContain('qhbcCH8Am4');
  });

  it('serves the ACP invite from GET /api/community/discord', async () => {
    const app = express();
    registerOpenDesignPublicMetadataRoutes(app, {
      http: {
        createSseResponse: () => undefined,
        isLocalSameOrigin: () => true,
        requireLocalDaemonRequest: () => undefined,
        resolvedPortRef: { current: 0 },
        sendApiError: () => undefined,
        sendLiveArtifactRouteError: () => undefined,
        sendMulterError: () => undefined,
      },
      openDesignPublicMetadata: {
        readGithubRepoStats: async () => {
          throw new Error('unused');
        },
        readLatestReleaseInfo: async () => {
          throw new Error('unused');
        },
        readDiscordPresence: async () => ({
          onlineCount: 12,
          memberCount: 34,
          fetchedAt: 99,
          stale: false,
        }),
      },
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/api/community/discord`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      inviteCode: string;
      inviteUrl: string;
      onlineCount: number;
      memberCount: number;
    };
    expect(body.inviteCode).toBe('jE4MzArHX');
    expect(body.inviteUrl).toBe('https://discord.gg/jE4MzArHX');
    expect(body.inviteCode).not.toBe('mHAjSMV6gz');
    expect(body.inviteUrl).not.toContain('qhbcCH8Am4');
    expect(body.onlineCount).toBe(12);
    expect(body.memberCount).toBe(34);
  });
});
