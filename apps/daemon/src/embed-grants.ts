import { createHmac, timingSafeEqual } from 'node:crypto';

export const EMBED_GRANT_COOKIE = 'od_embed';
export const EMBED_GRANT_TTL_MS = 12 * 60 * 60 * 1000;
export const EMBED_GRANT_QUERY = 't';

export type EmbedGrantPayload = {
  v: 1;
  pid: string;
  uid: string;
  iat: number;
  exp: number;
};

export type MintEmbedGrantOptions = {
  projectId: string;
  userId: string;
  ttlMs?: number;
  now?: Date | number;
};

export type MintEmbedGrantResult = {
  token: string;
  payload: EmbedGrantPayload;
  expiresAt: Date;
};

export type EmbedGrantRequestLike = {
  headers?: {
    cookie?: string | string[] | undefined;
    Cookie?: string | string[] | undefined;
    [name: string]: unknown;
  };
  query?: Record<string, unknown>;
  cookies?: Record<string, unknown>;
};

export type EmbedGrantResponseLike = {
  setHeader?(name: string, value: number | string | readonly string[]): unknown;
  append?(name: string, value: string): unknown;
};

const OPEN_PROBE_PATHS = new Set([
  '/health',
  '/api/health',
  '/ready',
  '/api/ready',
  '/version',
  '/api/version',
]);

const EMBED_GRANT_MINT_PATH = /^\/api\/projects\/[^/]+\/embed-grants(?:\/|$)/;
const PROJECT_SCOPED_PATH = /^\/(?:api\/)?projects\/([^/]+)/;

function toUnixMs(value: Date | number | undefined): number {
  // mint/verify `now` is a clock: Date or epoch milliseconds.
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return Date.now();
}

function expiryUnixMs(exp: Date | number): number {
  // Cookie exp is payload.exp (unix seconds) or a Date.
  if (exp instanceof Date) return exp.getTime();
  return exp * 1000;
}

function signPayloadBytes(apiToken: string, payloadBytes: Buffer): string {
  return createHmac('sha256', apiToken).update(payloadBytes).digest('base64url');
}

function timingSafeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

function normalizePathname(path: string): string {
  let pathname = path.trim();
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  return pathname.replace(/\/{2,}/g, '/');
}

function splitPath(path: string): { pathname: string; search: URLSearchParams } {
  const queryIndex = path.indexOf('?');
  const rawPath = queryIndex < 0 ? path : path.slice(0, queryIndex);
  const rawSearch = queryIndex < 0 ? '' : path.slice(queryIndex + 1);
  return { pathname: normalizePathname(rawPath), search: new URLSearchParams(rawSearch) };
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function projectIdFromPath(pathname: string): string | null {
  const match = PROJECT_SCOPED_PATH.exec(pathname);
  const segment = match?.[1];
  if (!segment) return null;
  return decodePathSegment(segment);
}

function cookieHeaderValue(headers: EmbedGrantRequestLike['headers']): string {
  const value = headers?.cookie ?? headers?.Cookie;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join('; ');
  return '';
}

function readNamedCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const key = (eq < 0 ? trimmed : trimmed.slice(0, eq)).trim();
    if (key !== name) continue;
    return eq < 0 ? '' : trimmed.slice(eq + 1).trim();
  }
  return null;
}

function readQueryParam(query: Record<string, unknown> | undefined, name: string): string | null {
  if (query == null || !Object.prototype.hasOwnProperty.call(query, name)) return null;
  const value = query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string');
    return typeof first === 'string' ? first : '';
  }
  if (value == null) return '';
  return String(value);
}

function asEmbedGrantPayload(value: unknown): EmbedGrantPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.v !== 1) return null;
  if (typeof rec.pid !== 'string' || rec.pid.length === 0) return null;
  if (typeof rec.uid !== 'string' || rec.uid.length === 0) return null;
  if (typeof rec.iat !== 'number' || !Number.isFinite(rec.iat)) return null;
  if (typeof rec.exp !== 'number' || !Number.isFinite(rec.exp)) return null;
  return { v: 1, pid: rec.pid, uid: rec.uid, iat: rec.iat, exp: rec.exp };
}

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

// GET/HEAD of non-/api paths is the Studio shell (express.static + SPA fallback).
// /artifacts and /frames are generated data planes, not shell assets.
function isStudioShellPath(pathname: string): boolean {
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname === '/artifacts' || pathname.startsWith('/artifacts/')) return false;
  if (pathname === '/frames' || pathname.startsWith('/frames/')) return false;
  return true;
}

export function mintEmbedGrant(
  apiToken: string,
  options: MintEmbedGrantOptions,
): MintEmbedGrantResult {
  const nowMs = toUnixMs(options.now);
  const ttlMs = options.ttlMs ?? EMBED_GRANT_TTL_MS;
  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + ttlMs) / 1000);
  const payload: EmbedGrantPayload = {
    v: 1,
    pid: options.projectId,
    uid: options.userId,
    iat,
    exp,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const token = `${payloadBytes.toString('base64url')}.${signPayloadBytes(apiToken, payloadBytes)}`;
  return { token, payload, expiresAt: new Date(exp * 1000) };
}

export function verifyEmbedGrant(
  apiToken: string,
  token: string,
  now?: Date | number,
): EmbedGrantPayload | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (encoded.length === 0 || signature.length === 0) return null;

  let payloadBytes: Buffer;
  try {
    payloadBytes = Buffer.from(encoded, 'base64url');
  } catch {
    return null;
  }
  if (payloadBytes.length === 0 || payloadBytes.toString('base64url') !== encoded) return null;
  const expected = signPayloadBytes(apiToken, payloadBytes);
  if (!timingSafeStringEquals(expected, signature)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  const payload = asEmbedGrantPayload(parsed);
  if (payload == null) return null;
  if (payload.exp * 1000 <= toUnixMs(now)) return null;
  return payload;
}

export function readEmbedGrantFromRequest(req: EmbedGrantRequestLike): string | null {
  const fromQuery = readQueryParam(req.query, EMBED_GRANT_QUERY);
  if (fromQuery !== null) return fromQuery.length > 0 ? fromQuery : null;
  const fromHeader = readNamedCookie(cookieHeaderValue(req.headers), EMBED_GRANT_COOKIE);
  if (fromHeader !== null) return fromHeader.length > 0 ? fromHeader : null;
  const fromCookies = req.cookies?.[EMBED_GRANT_COOKIE];
  return typeof fromCookies === 'string' && fromCookies.length > 0 ? fromCookies : null;
}

export function setEmbedGrantCookie(
  res: EmbedGrantResponseLike,
  token: string,
  exp: Date | number,
  options?: { secure?: boolean },
): void {
  const maxAge = Math.max(0, Math.floor((expiryUnixMs(exp) - Date.now()) / 1000));
  const parts = [
    `${EMBED_GRANT_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (options?.secure === true) parts.push('Secure');
  const header = parts.join('; ');
  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', header);
    return;
  }
  res.append?.('Set-Cookie', header);
}

export function embedGrantAllowsPath(
  grant: EmbedGrantPayload,
  method: string,
  path: string,
  query?: Record<string, unknown> | null,
): boolean {
  const methodUpper = method.toUpperCase();
  const { pathname, search } = splitPath(path);
  const queryProjectId = firstString(query?.projectId) ?? firstString(search.get('projectId'));

  if (EMBED_GRANT_MINT_PATH.test(pathname)) return false;

  const pathProjectId = projectIdFromPath(pathname);
  if (pathProjectId !== null) return pathProjectId === grant.pid;

  if (pathname === '/api/runs') return queryProjectId === grant.pid;

  if (!isReadMethod(methodUpper)) return false;
  if (OPEN_PROBE_PATHS.has(pathname)) return true;
  if (pathname === '/api/app-config') return true;
  if (pathname === '/api/projects') return true;
  return isStudioShellPath(pathname);
}
