import { afterEach, describe, expect, it } from 'vitest';

import {
  acpSsoLogoutUrl,
  acpSsoStartUrl,
  acpSsoUrlFromEnv,
  isAcpSsoConfigured,
  shouldRedirectSpaDocumentToAcpSso,
  spaDocumentReturnUrl,
} from '../src/acp-sso.js';

const PREVIOUS = process.env.OD_ACP_SSO_URL;

afterEach(() => {
  if (PREVIOUS === undefined) delete process.env.OD_ACP_SSO_URL;
  else process.env.OD_ACP_SSO_URL = PREVIOUS;
});

describe('acpSsoUrlFromEnv', () => {
  it('returns null when unset or unsafe', () => {
    delete process.env.OD_ACP_SSO_URL;
    expect(acpSsoUrlFromEnv()).toBeNull();
    expect(isAcpSsoConfigured()).toBe(false);

    process.env.OD_ACP_SSO_URL = 'http://evil.example/sso';
    expect(acpSsoUrlFromEnv()).toBeNull();

    process.env.OD_ACP_SSO_URL = 'https://user:pass@acp.example/sso';
    expect(acpSsoUrlFromEnv()).toBeNull();
  });

  it('accepts https and loopback http', () => {
    process.env.OD_ACP_SSO_URL = 'https://dev.agentcontrolpanel.dev/open-design/sso/';
    expect(acpSsoUrlFromEnv()).toBe('https://dev.agentcontrolpanel.dev/open-design/sso');
    expect(isAcpSsoConfigured()).toBe(true);

    process.env.OD_ACP_SSO_URL = 'http://127.0.0.1:4173/open-design/sso';
    expect(acpSsoUrlFromEnv()).toBe('http://127.0.0.1:4173/open-design/sso');
  });
});

describe('ACP SSO document handshake', () => {
  it('builds a return URL without t= and honors forwarded proto/host', () => {
    expect(spaDocumentReturnUrl({
      originalUrl: '/projects/proj_1?t=stale&acpEmbed=1',
      get: (name) => {
        if (name.toLowerCase() === 'x-forwarded-proto') return 'https, http';
        if (name.toLowerCase() === 'x-forwarded-host') return 'design.agentcontrolpanel.dev';
        return undefined;
      },
    })).toBe('https://design.agentcontrolpanel.dev/projects/proj_1?acpEmbed=1');
  });

  it('maps the SSO start URL to the ACP logout page', () => {
    expect(acpSsoLogoutUrl('https://agentcontrolpanel.dev/open-design/sso')).toBe(
      'https://agentcontrolpanel.dev/open-design/logout',
    );
    expect(acpSsoLogoutUrl('https://dev.agentcontrolpanel.dev/open-design/sso/')).toBe(
      'https://dev.agentcontrolpanel.dev/open-design/logout',
    );
    expect(acpSsoLogoutUrl(null)).toBeNull();
  });

  it('starts SSO with the full Open Design return URL', () => {
    expect(acpSsoStartUrl(
      'https://agentcontrolpanel.dev/open-design/sso',
      'https://design.agentcontrolpanel.dev/',
    )).toBe(
      'https://agentcontrolpanel.dev/open-design/sso?return=https%3A%2F%2Fdesign.agentcontrolpanel.dev%2F',
    );
  });

  it('re-handshakes cookie-only document loads and skips when t= is present', () => {
    process.env.OD_ACP_SSO_URL = 'https://agentcontrolpanel.dev/open-design/sso';
    expect(shouldRedirectSpaDocumentToAcpSso({ method: 'GET', queryGrant: false })).toBe(true);
    expect(shouldRedirectSpaDocumentToAcpSso({ method: 'GET', queryGrant: true })).toBe(false);
    expect(shouldRedirectSpaDocumentToAcpSso({ method: 'POST', queryGrant: false })).toBe(false);
    delete process.env.OD_ACP_SSO_URL;
    expect(shouldRedirectSpaDocumentToAcpSso({ method: 'GET', queryGrant: false })).toBe(false);
  });
});
