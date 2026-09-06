import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeAmcLaunchGrant,
  mintAmcLaunchGrant,
  resetAmcLaunchGrantsForTests,
  verifyAmcLaunchGrant,
} from '../src/amc-engine/studio-grant.js';
import { sanitizeProjectForGrant } from '../src/amc-engine/sanitize-project.js';
import { grantAllowsProjectApi, parseProjectHtmlPath } from '../src/amc-engine/project-api.js';
import { isAmcEngineProfile } from '../src/amc-engine/profile.js';
import { injectAmcEngineMarker, amcEngineDenyHtml, AMC_ENGINE_DENY_TITLE } from '../src/amc-engine/deny-page.js';
import { amcEngineHtmlGate } from '../src/amc-engine/html-gate.js';
import {
  createAmcStudioSession,
  decodeAmcStudioSession,
  encodeAmcStudioSession,
  resetAmcStudioSessionsForTests,
  safeLaunchNext,
} from '../src/amc-engine/studio-session.js';

const SECRET = 'test-studio-secret';

afterEach(() => {
  resetAmcLaunchGrantsForTests();
  resetAmcStudioSessionsForTests();
  delete process.env.OD_DEPLOYMENT_PROFILE;
  delete process.env.OD_HOST_MODE;
  delete process.env.OD_AMC_ENGINE;
});

describe('amc-engine profile', () => {
  it('reads OD_DEPLOYMENT_PROFILE=amc-engine', () => {
    expect(isAmcEngineProfile({})).toBe(false);
    expect(isAmcEngineProfile({ OD_DEPLOYMENT_PROFILE: 'amc-engine' })).toBe(true);
    expect(isAmcEngineProfile({ OD_HOST_MODE: 'amc' })).toBe(true);
  });
});

describe('launch grants', () => {
  it('verifies a minted grant and rejects replay', () => {
    const minted = mintAmcLaunchGrant({
      projectId: 'amc-frun-1',
      userId: 'user-1',
      secret: SECRET,
      now: 1_000_000,
    });
    const first = verifyAmcLaunchGrant(minted.token, { secret: SECRET, now: 1_000_000 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.projectId).toBe('amc-frun-1');
    expect(consumeAmcLaunchGrant(first, 1_000_000)).toBe(true);
    const replay = verifyAmcLaunchGrant(minted.token, { secret: SECRET, now: 1_000_000 });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe('token nonce already used');
  });

  it('rejects a tampered project id', () => {
    const minted = mintAmcLaunchGrant({
      projectId: 'amc-frun-1',
      userId: 'user-1',
      secret: SECRET,
    });
    const parts = minted.token.split('~');
    parts[1] = 'amc-frun-other';
    const verified = verifyAmcLaunchGrant(parts.join('~'), { secret: SECRET });
    expect(verified.ok).toBe(false);
  });

  it('rejects an expired grant', () => {
    const minted = mintAmcLaunchGrant({
      projectId: 'amc-frun-1',
      userId: 'user-1',
      secret: SECRET,
      ttlSec: 60,
      now: 1_000_000,
    });
    const verified = verifyAmcLaunchGrant(minted.token, { secret: SECRET, now: 1_000_000 + 61_000 });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe('token expired');
  });
});

describe('studio session', () => {
  it('round-trips a signed session on the allowlist', () => {
    const session = createAmcStudioSession('amc-frun-1', 1_000_000);
    const token = encodeAmcStudioSession(session, SECRET);
    expect(decodeAmcStudioSession(token, { secret: SECRET, now: 1_000_000 })?.projectId).toBe('amc-frun-1');
  });

  it('safeLaunchNext keeps this project and stamps amcEmbed', () => {
    expect(safeLaunchNext('/projects/amc-frun-1/conversations/c1/files/index.html', 'amc-frun-1'))
      .toBe('/projects/amc-frun-1/conversations/c1/files/index.html?amcEmbed=1&acpEmbed=1');
    expect(safeLaunchNext('/projects/other/files/index.html', 'amc-frun-1')).toBeNull();
    expect(safeLaunchNext('https://evil.example/projects/amc-frun-1', 'amc-frun-1')).toBeNull();
  });
});

describe('grant API matching', () => {
  it('allows project data plane and denies list/duplicate/delete', () => {
    expect(grantAllowsProjectApi({ method: 'GET', path: '/projects/p1/files' }, 'p1')).toBe(true);
    expect(grantAllowsProjectApi({ method: 'GET', path: '/projects/p1/events' }, 'p1')).toBe(true);
    expect(grantAllowsProjectApi({ method: 'GET', path: '/projects/p1/workspace-scope' }, 'p1')).toBe(true);
    expect(grantAllowsProjectApi({ method: 'GET', path: '/projects/p2/files' }, 'p1')).toBe(false);
    expect(grantAllowsProjectApi({ method: 'POST', path: '/projects/p1/duplicate' }, 'p1')).toBe(false);
    expect(grantAllowsProjectApi({ method: 'DELETE', path: '/projects/p1' }, 'p1')).toBe(false);
    expect(parseProjectHtmlPath('/projects/p1/conversations/c/files/index.html')?.projectId).toBe('p1');
  });
});

describe('payload sanitization and deny page', () => {
  it('strips pendingPrompt from grant-visible project JSON', () => {
    const sanitized = sanitizeProjectForGrant({
      id: 'p1',
      name: 'Design',
      pendingPrompt: 'SECRET BRIEF',
      metadata: { amc: true, amcGrokHome: '/tmp/grok' },
    });
    expect(sanitized).toEqual({
      id: 'p1',
      name: 'Design',
      metadata: { amc: true },
    });
  });

  it('injects the engine marker into HTML', () => {
    const html = injectAmcEngineMarker('<!doctype html><html><head></head><body></body></html>');
    expect(html).toContain('__OD_AMC_ENGINE__');
    expect(amcEngineDenyHtml()).toContain('ACP Design engine');
  });
});

describe('html gate', () => {
  function htmlReq(pathname: string, cookie = '') {
    return {
      method: 'GET',
      path: pathname,
      get(name: string) {
        if (name.toLowerCase() === 'accept') return 'text/html';
        if (name.toLowerCase() === 'cookie') return cookie;
        return undefined;
      },
      headers: { cookie },
    };
  }

  it('denies / and marketplace when the profile is on', () => {
    process.env.OD_DEPLOYMENT_PROFILE = 'amc-engine';
    let status = 0;
    let body = '';
    const res = {
      status(code: number) {
        status = code;
        return {
          type() {
            return {
              send(html: string) {
                body = html;
                return html;
              },
            };
          },
        };
      },
    };
    const next = () => {
      status = 200;
    };
    amcEngineHtmlGate(htmlReq('/') as never, res as never, next);
    expect(status).toBe(404);
    expect(body).toContain(AMC_ENGINE_DENY_TITLE);
    status = 0;
    amcEngineHtmlGate(htmlReq('/marketplace') as never, res as never, next);
    expect(status).toBe(404);
    amcEngineHtmlGate(htmlReq('/projects/guess') as never, res as never, next);
    expect(status).toBe(404);
    expect(body).not.toContain('guess');
  });
});
