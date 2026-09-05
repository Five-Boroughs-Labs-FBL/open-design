import { afterEach, describe, expect, it } from 'vitest';

import { acpSsoUrlFromEnv, isAcpSsoConfigured } from '../src/acp-sso.js';

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
