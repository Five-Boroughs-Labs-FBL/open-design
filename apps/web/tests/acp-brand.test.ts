// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ACP_OPEN_DESIGN_NAME,
  ACP_STUDIO_PREVIEW_KEY,
  ACP_STUDIO_THEME_KEY,
  applyAcpStudioAppearance,
  isAcpHostedHostname,
  isAcpStudioShell,
  readAcpStudioTheme,
  setAcpStudioTheme,
  toggleAcpStudioTheme,
} from '../src/acp-brand';
import { OD_EMBED_SESSION_KEY } from '../src/amc-embed';
import { applyAppearanceToDocument } from '../src/state/appearance';

function hostedWin(overrides: Partial<Window> = {}): Window {
  return {
    location: { hostname: 'design.agentcontrolpanel.dev', search: '' },
    document,
    sessionStorage,
    localStorage,
    dispatchEvent: window.dispatchEvent.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    ...overrides,
  } as unknown as Window;
}

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

describe('local acpStudio=1 preview', () => {
  afterEach(() => {
    sessionStorage.removeItem(ACP_STUDIO_PREVIEW_KEY);
    localStorage.removeItem(ACP_STUDIO_THEME_KEY);
    document.documentElement.removeAttribute('data-acp-studio');
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('latches ACP Studio appearance from ?acpStudio=1 on localhost', () => {
    const win = hostedWin({
      location: { hostname: 'localhost', search: '?acpStudio=1' } as Location,
    });
    expect(isAcpStudioShell(win)).toBe(true);
    expect(sessionStorage.getItem(ACP_STUDIO_PREVIEW_KEY)).toBe('1');
    expect(applyAcpStudioAppearance(win)).toBe(true);
    expect(document.documentElement.dataset.acpStudio).toBe('1');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('isAcpStudioShell / applyAcpStudioAppearance', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-acp-studio');
    document.documentElement.removeAttribute('data-amc-embed');
    document.documentElement.removeAttribute('data-acp-embed');
    document.documentElement.setAttribute('data-theme', 'light');
    sessionStorage.removeItem(OD_EMBED_SESSION_KEY);
    sessionStorage.removeItem(ACP_STUDIO_PREVIEW_KEY);
    localStorage.removeItem(ACP_STUDIO_THEME_KEY);
    document.title = 'OpenDesign';
  });

  it('stamps ACP Open Design identity on the hosted studio host', () => {
    const win = hostedWin();
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
    const win = hostedWin({
      location: { hostname: 'design.agentcontrolpanel.dev', search: '?acpEmbed=1' } as Location,
    });
    expect(isAcpStudioShell(win)).toBe(false);
    expect(applyAcpStudioAppearance(win)).toBe(false);
    expect(document.documentElement.dataset.acpStudio).toBeUndefined();
  });

  it('restores a stored light ACP theme instead of forcing dark', () => {
    const win = hostedWin();
    localStorage.setItem(ACP_STUDIO_THEME_KEY, 'light');
    expect(applyAcpStudioAppearance(win)).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(readAcpStudioTheme(win)).toBe('light');
  });

  it('toggles ACP theme and persists the pick', () => {
    const win = hostedWin();
    applyAcpStudioAppearance(win);
    expect(toggleAcpStudioTheme(win)).toBe('light');
    expect(localStorage.getItem(ACP_STUDIO_THEME_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(setAcpStudioTheme('dark', win)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('does not let the OpenDesign light stamp overwrite ACP theme', () => {
    const win = hostedWin();
    applyAcpStudioAppearance(win);
    applyAppearanceToDocument({ accentColor: '#059669' });
    expect(document.documentElement.getAttribute('data-acp-studio')).toBe('1');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });
});

describe('ACP Studio CSS', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/acp-studio.css'),
    'utf8',
  );

  it('paints a graphite rail on ACP dark instead of the milky white frost', () => {
    expect(css).toContain("html[data-acp-studio][data-theme='dark'] .entry-nav-rail__panel");
    expect(css).toContain('--rail-surface: rgba(13, 15, 21, 0.92)');
  });

  it('carries ACP day-mode tokens for the theme toggle', () => {
    expect(css).toContain("html[data-acp-studio][data-theme='light']");
    expect(css).toContain('--bg: #f6f4f1');
    expect(css).toContain('.acp-studio-theme-toggle');
    expect(css).toContain('--rotating-title-accent: #ff7a29');
  });

  it('styles the SSO pane as an ACP auth card and hides product tabs', () => {
    expect(css).toContain('.acp-sso-card__eyebrow');
    expect(css).toContain('.acp-sso-card__title');
    expect(css).toContain('.acp-sso-header');
    expect(css).toContain('.workspace-shell:has(.entry-shell--onboarding)');
    expect(css).toContain('.home-hero__composer-beam[data-beam=\'composer\']');
  });
});

describe('ACP Studio FOUC script', () => {
  const layoutPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../app/layout.tsx',
  );

  function runThemeInitScript(): void {
    const source = readFileSync(layoutPath, 'utf8');
    const match = /const themeInitScript = `([^`]*)`;/.exec(source);
    if (!match?.[1]) throw new Error('themeInitScript not found in app/layout.tsx');
    // eslint-disable-next-line no-new-func
    new Function(match[1])();
  }

  afterEach(() => {
    sessionStorage.removeItem(ACP_STUDIO_PREVIEW_KEY);
    localStorage.removeItem(ACP_STUDIO_THEME_KEY);
    document.documentElement.removeAttribute('data-acp-studio');
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('paints stored ACP light theme before hydration on a latched preview', () => {
    sessionStorage.setItem(ACP_STUDIO_PREVIEW_KEY, '1');
    localStorage.setItem(ACP_STUDIO_THEME_KEY, 'light');
    runThemeInitScript();
    expect(document.documentElement.getAttribute('data-acp-studio')).toBe('1');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('defaults ACP Studio FOUC to dark when no preference is stored', () => {
    sessionStorage.setItem(ACP_STUDIO_PREVIEW_KEY, '1');
    runThemeInitScript();
    expect(document.documentElement.getAttribute('data-acp-studio')).toBe('1');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
