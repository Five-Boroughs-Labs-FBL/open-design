import { isLoopbackHostname } from './http/local-daemon-request.js';

/**
 * Hosted Open Design can replace OpenDesign Cloud device-auth with an ACP
 * handshake. When this URL is set, the SPA shell is served without Basic so
 * "Sign in with ACP" can render, then redirect here with `?return=`.
 */
export function acpSsoUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.OD_ACP_SSO_URL ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') {
      return `${url.origin}${url.pathname}`.replace(/\/$/, '') || url.origin;
    }
    if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) {
      return `${url.origin}${url.pathname}`.replace(/\/$/, '') || url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function isAcpSsoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return acpSsoUrlFromEnv(env) != null;
}
