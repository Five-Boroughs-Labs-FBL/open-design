/**
 * Hosted ACP Studio identity. Local desktop / tools-dev stay OpenDesign.
 *
 * Brand tokens match Agent Control Panel: signal amber and the radar mark.
 */
import { isAmcEmbedActive, rememberEmbedGrantSession } from './amc-embed';

export const ACP_OPEN_DESIGN_NAME = 'ACP Open Design';
export const ACP_OPEN_DESIGN_SUBTITLE = 'Agent Control Panel';
export const ACP_OPEN_DESIGN_LOADING = 'Loading ACP Open Design…';
export const ACP_ACCENT = '#FF7A29';

export type AcpStudioTheme = 'light' | 'dark';

export const ACP_STUDIO_DEFAULT_THEME: AcpStudioTheme = 'dark';
export const ACP_STUDIO_THEME_KEY = 'od-acp-studio-theme';
export const ACP_STUDIO_THEME_EVENT = 'od-acp-studio-theme';
export const ACP_STUDIO_PREVIEW_KEY = 'od-acp-studio-preview';

const ACP_STUDIO_HOST = /(^|\.)design\.agentcontrolpanel\.dev$/i;
const ACP_THEME_COLOR: Record<AcpStudioTheme, string> = {
  dark: '#07080B',
  light: '#F6F4F1',
};

export function isAcpHostedHostname(hostname: string): boolean {
  return ACP_STUDIO_HOST.test(hostname.trim());
}

export function isAcpStudioPreview(win: Window = window): boolean {
  try {
    const params = new URLSearchParams(win.location.search.startsWith('?') ? win.location.search.slice(1) : win.location.search);
    if (params.get('acpStudio') === '1') {
      win.sessionStorage.setItem(ACP_STUDIO_PREVIEW_KEY, '1');
      return true;
    }
    return win.sessionStorage.getItem(ACP_STUDIO_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Full-page ACP Studio (SSO on design.*). Iframe embeds already hide chrome
 * via `data-amc-embed` and should not grow a second brand lockup.
 * `?acpStudio=1` is a local preview latch (sessionStorage).
 */
export function isAcpStudioShell(win: Window = window): boolean {
  if (isAmcEmbedActive(win)) return false;
  if (isAcpHostedHostname(win.location.hostname)) return true;
  if (isAcpStudioPreview(win)) return true;
  return rememberEmbedGrantSession(win);
}

const INLINE_ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-tint',
  '--accent-hover',
] as const;

export function readAcpStudioTheme(win: Window = window): AcpStudioTheme {
  try {
    const stored = win.localStorage.getItem(ACP_STUDIO_THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private mode / non-browser */
  }
  return ACP_STUDIO_DEFAULT_THEME;
}

export function applyAcpStudioTheme(theme: AcpStudioTheme, win: Window = window): void {
  const root = win.document.documentElement;
  root.setAttribute('data-theme', theme);
  try {
    root.style.colorScheme = theme;
  } catch {
    /* jsdom / older browsers */
  }
  const themeColor = win.document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', ACP_THEME_COLOR[theme]);
}

export function setAcpStudioTheme(theme: AcpStudioTheme, win: Window = window): AcpStudioTheme {
  try {
    win.localStorage.setItem(ACP_STUDIO_THEME_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
  applyAcpStudioTheme(theme, win);
  try {
    win.dispatchEvent(new Event(ACP_STUDIO_THEME_EVENT));
  } catch {
    /* jsdom without EventTarget on window */
  }
  return theme;
}

export function toggleAcpStudioTheme(win: Window = window): AcpStudioTheme {
  return setAcpStudioTheme(readAcpStudioTheme(win) === 'light' ? 'dark' : 'light', win);
}

/** Stamp ACP theme, title, and `data-acp-studio` for hosted Studio. */
export function applyAcpStudioAppearance(win: Window = window): boolean {
  if (!isAcpStudioShell(win)) return false;
  const root = win.document.documentElement;
  root.dataset.acpStudio = '1';
  win.document.title = ACP_OPEN_DESIGN_NAME;
  for (const name of INLINE_ACCENT_VARS) {
    root.style.removeProperty(name);
  }
  applyAcpStudioTheme(readAcpStudioTheme(win), win);
  return true;
}
