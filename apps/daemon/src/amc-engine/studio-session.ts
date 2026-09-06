import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { amcEngineStudioSecret } from './profile.js';

export const SESSION_TTL_SEC = 4 * 60 * 60;
export const SESSION_COOKIE_HTTP = 'od_amc_studio';
export const SESSION_COOKIE_HOST = '__Host-od_amc_studio';
const FIELD_SEP = '.';

export type AmcStudioSession = {
  sid: string;
  projectId: string;
  expMs: number;
};

const allowlist = new Map<string, AmcStudioSession>();

export function resetAmcStudioSessionsForTests(): void {
  allowlist.clear();
}

function timingSafeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sign(secret: string, parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\n')).digest('base64url');
}

function prune(now: number): void {
  for (const [sid, row] of allowlist) {
    if (row.expMs <= now) allowlist.delete(sid);
  }
}

export function isSecureRequest(req: {
  secure?: boolean;
  protocol?: string;
  get?: (name: string) => string | undefined;
}): boolean {
  if (req.secure) return true;
  if (String(req.protocol || '') === 'https') return true;
  const forwarded = String(req.get?.('x-forwarded-proto') || '').split(',')[0]?.trim();
  return forwarded === 'https';
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_HOST : SESSION_COOKIE_HTTP;
}

export function createAmcStudioSession(projectId: string, now = Date.now()): AmcStudioSession {
  const pid = String(projectId || '').trim();
  if (!pid) throw new Error('projectId required');
  prune(now);
  const session: AmcStudioSession = {
    sid: randomBytes(16).toString('hex'),
    projectId: pid,
    expMs: now + SESSION_TTL_SEC * 1000,
  };
  allowlist.set(session.sid, session);
  return session;
}

export function encodeAmcStudioSession(
  session: AmcStudioSession,
  secret = amcEngineStudioSecret(),
): string {
  const exp = String(session.expMs);
  const signature = sign(secret, [session.sid, session.projectId, exp]);
  return ['v1', session.sid, session.projectId, exp, signature].join(FIELD_SEP);
}

export function decodeAmcStudioSession(
  token: string,
  options: { now?: number; secret?: string } = {},
): AmcStudioSession | null {
  const secret = String(options.secret || amcEngineStudioSecret()).trim();
  if (!secret) return null;
  const parts = String(token || '').split(FIELD_SEP);
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [, sid, projectId, exp, signature] = parts as [string, string, string, string, string];
  if (!sid || !projectId || !exp || !signature) return null;
  const expected = sign(secret, [sid, projectId, exp]);
  if (!timingSafeStringEquals(expected, signature)) return null;
  const expMs = Number(exp);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  if (!Number.isFinite(expMs) || expMs <= now) return null;
  prune(now);
  const row = allowlist.get(sid);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

export function revokeAmcStudioSession(projectId: string, sid?: string): number {
  const pid = String(projectId || '').trim();
  let n = 0;
  for (const [id, row] of allowlist) {
    if (row.projectId !== pid) continue;
    if (sid && id !== sid) continue;
    allowlist.delete(id);
    n += 1;
  }
  return n;
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function readAmcStudioSessionFromRequest(req: {
  headers?: { cookie?: string };
  get?: (name: string) => string | undefined;
}): AmcStudioSession | null {
  const header = req.get?.('cookie') || req.headers?.cookie;
  const cookies = parseCookieHeader(header);
  const token = cookies[SESSION_COOKIE_HOST] || cookies[SESSION_COOKIE_HTTP] || '';
  if (!token) return null;
  return decodeAmcStudioSession(token);
}

export function serializeSessionCookie(
  req: { secure?: boolean; protocol?: string; get?: (name: string) => string | undefined },
  session: AmcStudioSession,
): string {
  const secure = isSecureRequest(req);
  const name = sessionCookieName(secure);
  const value = encodeAmcStudioSession(session);
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function safeLaunchNext(raw: string, projectId: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return `/projects/${encodeURIComponent(projectId)}?amcEmbed=1&acpEmbed=1`;
  if (!value.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://od.invalid');
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  const path = url.pathname || '';
  const prefix = `/projects/${encodeURIComponent(projectId)}`;
  const decodedPrefix = `/projects/${projectId}`;
  if (path !== prefix && path !== decodedPrefix && !path.startsWith(`${prefix}/`) && !path.startsWith(`${decodedPrefix}/`)) {
    return null;
  }
  url.searchParams.set('amcEmbed', '1');
  url.searchParams.set('acpEmbed', '1');
  url.searchParams.delete('t');
  url.searchParams.delete('g');
  return `${url.pathname}${url.search}`;
}
