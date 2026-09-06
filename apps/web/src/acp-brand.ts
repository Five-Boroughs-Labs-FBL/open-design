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

const ACP_STUDIO_HOST = /(^|\.)design\.agentcontrolpanel\.dev$/i;

export function isAcpHostedHostname(hostname: string): boolean {
  return ACP_STUDIO_HOST.test(hostname.trim());
}

/**
 * Full-page ACP Studio (SSO on design.*). Iframe embeds already hide chrome
 * via `data-amc-embed` and should not grow a second brand lockup.
 */
export function isAcpStudioShell(win: Window = window): boolean {
  if (isAmcEmbedActive(win)) return false;
  if (isAcpHostedHostname(win.location.hostname)) return true;
  return rememberEmbedGrantSession(win);
}

const INLINE_ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-tint',
  '--accent-hover',
] as const;

/** Stamp dark ACP theme, title, and `data-acp-studio` for hosted Studio. */
export function applyAcpStudioAppearance(win: Window = window): boolean {
  if (!isAcpStudioShell(win)) return false;
  const root = win.document.documentElement;
  root.dataset.acpStudio = '1';
  root.setAttribute('data-theme', 'dark');
  win.document.title = ACP_OPEN_DESIGN_NAME;
  for (const name of INLINE_ACCENT_VARS) {
    root.style.removeProperty(name);
  }
  const themeColor = win.document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', '#07080B');
  return true;
}
