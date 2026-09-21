// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ACP_OPEN_DESIGN_NAME,
  ACP_SKIP_AMR_AUTH_GATE,
  ACP_STUDIO_PREVIEW_KEY,
  ACP_STUDIO_THEME_KEY,
  applyAcpStudioAppearance,
  hasAcpStudioIdentity,
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
  it('matches the hosted ACP Design studio hosts', () => {
    expect(isAcpHostedHostname('design.agentcontrolpanel.dev')).toBe(true);
    expect(isAcpHostedHostname('dev.design.agentcontrolpanel.dev')).toBe(true);
  });

  it('does not match ACP itself or local ACP Design', () => {
    expect(isAcpHostedHostname('agentcontrolpanel.dev')).toBe(false);
    expect(isAcpHostedHostname('localhost')).toBe(false);
    expect(isAcpHostedHostname('127.0.0.1')).toBe(false);
  });
});

describe('hasAcpStudioIdentity', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-acp-studio');
    document.documentElement.removeAttribute('data-amc-embed');
    document.documentElement.removeAttribute('data-acp-embed');
    sessionStorage.removeItem(OD_EMBED_SESSION_KEY);
    sessionStorage.removeItem(ACP_STUDIO_PREVIEW_KEY);
  });

  it('skips the AMR bounce gate on hosted studio when the flag is on', () => {
    expect(ACP_SKIP_AMR_AUTH_GATE).toBe(true);
    expect(hasAcpStudioIdentity(hostedWin())).toBe(true);
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
    document.title = 'ACP Design';
  });

  it('stamps ACP Design identity on the hosted studio host', () => {
    expect(ACP_OPEN_DESIGN_NAME).toBe('ACP Design');
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

  it('does not let the ACP Design light stamp overwrite ACP theme', () => {
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

  it('paints the ACP peak mark ice-on-navy instead of the radar sweep', () => {
    expect(css).toContain('.acp-mark');
    expect(css).toContain('--color-logo: #d7fbff');
    expect(css).toContain('--color-logo-ink: #071225');
    expect(css).toContain('@keyframes acp-mark-glow');
    expect(css).not.toContain('.acp-radar-mark');
    expect(css).not.toContain('@keyframes acp-radar-sweep');
  });

  it('keeps the peak ice-cyan on the navy lockup tile in light theme', () => {
    // html[data-acp-studio][data-theme=light] .acp-mark is navy for bare marks.
    // The lockup tile is navy in both themes, so that rule would paint the
    // peak navy-on-navy unless the badge override is at least as specific.
    expect(css).toContain(
      "html[data-acp-studio][data-theme='light'] .acp-studio-lockup__badge .acp-mark",
    );
    expect(css).toMatch(
      /html\[data-acp-studio\]\[data-theme='light'\] \.acp-studio-lockup__badge \.acp-mark\s*\{[^}]*color:\s*var\(--color-logo,\s*#d7fbff\)/s,
    );
  });

  it('keeps the SSO product name opaque so dark theme cannot drop it after the card animation', () => {
    const titleEm = /\.acp-sso-card__title em\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';
    expect(titleEm).toMatch(/color:\s*var\(--brand-text\)/);
    expect(titleEm).not.toMatch(/transparent/);
    const cardIn = /@keyframes acp-sso-card-in\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(cardIn).toMatch(/opacity/);
    expect(cardIn).not.toMatch(/transform:/);
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

describe('ACP Studio favicon', () => {
  afterEach(() => {
    sessionStorage.removeItem(ACP_STUDIO_PREVIEW_KEY);
    document.documentElement.removeAttribute('data-acp-studio');
    document.head.querySelectorAll('link[rel="icon"]').forEach((node) => node.remove());
  });

  it('ships the peak mark as the hosted Studio favicon', () => {
    const favicon = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../public/acp-favicon.svg'),
      'utf8',
    );
    expect(favicon).toContain('viewBox="0 0 32 32"');
    expect(favicon).toContain('#071225');
    expect(favicon).toContain('#D7FBFF');
    expect(favicon).toContain(
      'M 15.91 3.5 L 30 28.51 L 2 28.51 Z M 15.44 11.9 L 23.84 26.27 L 27.76 28.51 L 4.24 28.51 Z',
    );
    expect(favicon).toContain('M 15.81 16.38 L 16.75 18.06 L 11.15 26.27 L 4.99 28.33 Z');
  });

  it('points the document icon at the ACP peak favicon on Studio', () => {
    sessionStorage.setItem(ACP_STUDIO_PREVIEW_KEY, '1');
    expect(applyAcpStudioAppearance(window)).toBe(true);
    const icon = document.head.querySelector('link[rel="icon"]');
    expect(icon?.getAttribute('href')).toBe('/acp-favicon.svg');
    expect(icon?.getAttribute('type')).toBe('image/svg+xml');
  });
});
