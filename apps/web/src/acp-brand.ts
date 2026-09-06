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

function accentVars(accent: string): Record<string, string> {
  return {
    '--accent': accent,
    '--accent-strong': `color-mix(in srgb, ${accent} 82%, var(--text-strong))`,
    '--accent-soft': `color-mix(in srgb, ${accent} 12%, var(--bg-subtle))`,
    '--accent-tint': `color-mix(in srgb, ${accent} 6%, var(--bg-panel))`,
    '--accent-hover': `color-mix(in srgb, ${accent} 86%, var(--text-strong))`,
  };
}

/** Stamp title, accent, and `data-acp-studio` for hosted ACP Studio. */
export function applyAcpStudioAppearance(win: Window = window): boolean {
  if (!isAcpStudioShell(win)) return false;
  const root = win.document.documentElement;
  root.dataset.acpStudio = '1';
  win.document.title = ACP_OPEN_DESIGN_NAME;
  const vars = accentVars(ACP_ACCENT);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  return true;
}
