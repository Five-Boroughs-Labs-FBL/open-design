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

export function acpSsoStartUrl(ssoUrl: string, returnUrl: string): string {
  const url = new URL(ssoUrl);
  url.searchParams.set('return', returnUrl);
  return url.toString();
}

/** ACP page that clears the ACP session after Open Design drops `od_embed`. */
export function acpSsoLogoutUrl(ssoUrl: string | null | undefined): string | null {
  if (!ssoUrl) return null;
  try {
    const url = new URL(ssoUrl);
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/open-design/sso')
      ? `${path.slice(0, -'/open-design/sso'.length)}/open-design/logout`
      : '/open-design/logout';
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/$/, '') || url.origin;
  } catch {
    return null;
  }
}

function firstHeader(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

function requestHeader(
  req: {
    get?: (name: string) => string | undefined;
    headers?: Record<string, unknown>;
  },
  name: string,
): string | undefined {
  if (typeof req.get === 'function') {
    const value = req.get(name);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return firstHeader(req.headers?.[name] ?? req.headers?.[name.toLowerCase()]);
}

/** Public URL of this SPA document, without `t=`, for ACP SSO return. */
export function spaDocumentReturnUrl(req: {
  protocol?: string;
  secure?: boolean;
  originalUrl?: string;
  url?: string;
  get?: (name: string) => string | undefined;
  headers?: Record<string, unknown>;
}): string {
  const forwarded = requestHeader(req, 'x-forwarded-proto');
  const proto = forwarded?.split(',')[0]?.trim().toLowerCase()
    || (req.secure === true ? 'https' : null)
    || (req.protocol === 'https' ? 'https' : 'http');
  const host = requestHeader(req, 'x-forwarded-host')
    || requestHeader(req, 'host')
    || 'localhost';
  const path = (typeof req.originalUrl === 'string' && req.originalUrl.length > 0)
    ? req.originalUrl
    : (typeof req.url === 'string' && req.url.length > 0 ? req.url : '/');
  const url = new URL(path, `${proto}://${host}`);
  url.searchParams.delete('t');
  return url.toString();
}

/**
 * Full document loads (including refresh) re-run ACP SSO unless this request
 * already carries `t=`. A leftover od_embed cookie from a previous ACP user
 * must not skip the handshake.
 */
export function shouldRedirectSpaDocumentToAcpSso(input: {
  method?: string;
  queryGrant: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!isAcpSsoConfigured(input.env)) return false;
  const method = (input.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (input.queryGrant) return false;
  return true;
}
