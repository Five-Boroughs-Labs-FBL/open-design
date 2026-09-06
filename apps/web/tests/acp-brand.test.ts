// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  ACP_OPEN_DESIGN_NAME,
  applyAcpStudioAppearance,
  isAcpHostedHostname,
  isAcpStudioShell,
} from '../src/acp-brand';
import { OD_EMBED_SESSION_KEY } from '../src/amc-embed';

describe('isAcpHostedHostname', () => {
  it('matches the hosted Open Design studio hosts', () => {
    expect(isAcpHostedHostname('design.agentcontrolpanel.dev')).toBe(true);
    expect(isAcpHostedHostname('dev.design.agentcontrolpanel.dev')).toBe(true);
  });

  it('does not match ACP itself or local OpenDesign', () => {
    expect(isAcpHostedHostname('agentcontrolpanel.dev')).toBe(false);
    expect(isAcpHostedHostname('localhost')).toBe(false);
    expect(isAcpHostedHostname('127.0.0.1')).toBe(false);
  });
});

describe('isAcpStudioShell / applyAcpStudioAppearance', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-acp-studio');
    document.documentElement.removeAttribute('data-amc-embed');
    document.documentElement.removeAttribute('data-acp-embed');
    document.documentElement.setAttribute('data-theme', 'light');
    sessionStorage.removeItem(OD_EMBED_SESSION_KEY);
    document.title = 'OpenDesign';
  });

  it('stamps ACP Open Design identity on the hosted studio host', () => {
    const win = {
      location: { hostname: 'design.agentcontrolpanel.dev', search: '' },
      document,
      sessionStorage,
    } as unknown as Window;
    Object.defineProperty(win.document, 'documentElement', {
      configurable: true,
      value: document.documentElement,
    });
    expect(isAcpStudioShell(win)).toBe(true);
    expect(applyAcpStudioAppearance(win)).toBe(true);
    expect(document.documentElement.dataset.acpStudio).toBe('1');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.title).toBe(ACP_OPEN_DESIGN_NAME);
  });

  it('does not restyle an ACP iframe embed', () => {
    document.documentElement.dataset.amcEmbed = '1';
    const win = {
      location: { hostname: 'design.agentcontrolpanel.dev', search: '?acpEmbed=1' },
      document,
      sessionStorage,
    } as unknown as Window;
    expect(isAcpStudioShell(win)).toBe(false);
    expect(applyAcpStudioAppearance(win)).toBe(false);
    expect(document.documentElement.dataset.acpStudio).toBeUndefined();
  });
});
