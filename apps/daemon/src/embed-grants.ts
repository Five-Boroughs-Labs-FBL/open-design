import { createHmac, timingSafeEqual } from 'node:crypto';
import { configuredAllowedOrigins } from './origin-validation.js';

export const EMBED_GRANT_COOKIE = 'od_embed';
export const PARTITIONED_EMBED_GRANT_COOKIE = '__Host-od_embed_partitioned';
/** Non-secret latch so the SPA can remember an embed session after `t` is stripped. Not a credential. */
export const EMBED_GRANT_HINT_COOKIE = 'od_embed_hint';
/**
 * One-shot latch set when `t` is exchanged for the session cookie. It lets the
 * immediate redirect land on the shell. It is not a credential.
 */
export const EMBED_GRANT_HANDOFF_COOKIE = 'od_embed_handoff';
const EMBED_GRANT_HANDOFF_MAX_AGE_SEC = 120;
export const EMBED_GRANT_TTL_MS = 12 * 60 * 60 * 1000;
/** Same-site handoff parameter. Not accepted as a bearer for workspace APIs. */
export const EMBED_GRANT_QUERY = 't';
export const CATALOG_EMBED_GRANT_PID = '*';
export const EMBED_GRANT_MAX_PIDS = 200;

export type EmbedGrantPayload = {
  v: 1;
  pid: string;
  uid: string;
  iat: number;
  exp: number;
  pids?: string[];
  /** Catalog-only. ACP admin sessions may write process-wide host settings. */
  adm?: true;
};

/** Catalog grants use pid `*`. The type predicate must name this subtype — `grant is EmbedGrantPayload` makes the false branch `never` under tsc. */
export type CatalogEmbedGrantPayload = EmbedGrantPayload & {
  pid: typeof CATALOG_EMBED_GRANT_PID;
};

export type MintEmbedGrantOptions = {
  projectId: string;
  userId: string;
  ttlMs?: number;
  now?: Date | number;
  projectIds?: readonly string[];
  admin?: boolean;
};

export type EmbedGrantProjectRecord = {
  id: string;
  metadata?: unknown;
};

export type EmbedGrantProjectLookup = (
  projectId: string,
) => EmbedGrantProjectRecord | null | undefined;

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
  '/api/public-runtime',
  '/api/embed-session/logout',
]);

/** Read-only Studio catalogs an embed session needs to generate. Writes stay denied. */
const STUDIO_EMBED_READ_PREFIXES = [
  '/api/app-config',
  '/api/agents',
  '/api/projects',
  '/api/plugins',
  '/api/skills',
  '/api/design-templates',
  '/api/design-systems',
  '/api/prompt-templates',
  '/api/atoms',
  '/api/codex-pets',
] as const;

function isStudioEmbedReadPath(pathname: string): boolean {
  for (const prefix of STUDIO_EMBED_READ_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

const EMBED_GRANT_MINT_PATH = /^\/api\/projects\/[^/]+\/embed-grants(?:\/|$)/;
const CATALOG_EMBED_GRANT_MINT_PATH = '/api/embed-grants';
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

/**
 * A grant `pid` is an Open Design project id. Callers that stuffed the studio
 * URL (or its path) into `pid` still name that project — `/projects/:id/...`
 * covers `:id`, not the whole string.
 */
function projectIdFromGrantPid(pid: string): string | null {
  let path = pid.trim();
  if (!path.includes('/')) return null;
  if (path.includes('://')) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/')) path = `/${path}`;
  return projectIdFromPath(normalizePathname(path));
}

/** Signed project ids this grant names. Catalog `*` is not itself a project id. */
function embedGrantCoversProjectId(grant: EmbedGrantPayload, projectId: string): boolean {
  if (projectId.length === 0) return false;
  if (projectId === grant.pid) return true;
  if (grant.pids?.includes(projectId)) return true;
  return projectIdFromGrantPid(grant.pid) === projectId;
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

export function normalizeEmbedGrantProjectIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || id === CATALOG_EMBED_GRANT_PID || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= EMBED_GRANT_MAX_PIDS) break;
  }
  return out;
}

function asEmbedGrantPayload(value: unknown): EmbedGrantPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.v !== 1) return null;
  if (typeof rec.pid !== 'string' || rec.pid.length === 0) return null;
  if (typeof rec.uid !== 'string' || rec.uid.length === 0) return null;
  if (typeof rec.iat !== 'number' || !Number.isFinite(rec.iat)) return null;
  if (typeof rec.exp !== 'number' || !Number.isFinite(rec.exp)) return null;
  const payload: EmbedGrantPayload = {
    v: 1,
    pid: rec.pid,
    uid: rec.uid,
    iat: rec.iat,
    exp: rec.exp,
  };
  if (rec.pids !== undefined) {
    if (!Array.isArray(rec.pids) || rec.pids.length > EMBED_GRANT_MAX_PIDS) return null;
    const pids: string[] = [];
    for (const item of rec.pids) {
      if (typeof item !== 'string' || item.length === 0) return null;
      pids.push(item);
    }
    if (pids.length > 0) payload.pids = pids;
  }
  if (rec.adm === true && rec.pid === CATALOG_EMBED_GRANT_PID) {
    payload.adm = true;
  }
  return payload;
}

export function isCatalogEmbedGrant(
  grant: EmbedGrantPayload | null | undefined,
): grant is CatalogEmbedGrantPayload {
  return grant != null && grant.pid === CATALOG_EMBED_GRANT_PID;
}

export function isCatalogAdminEmbedGrant(
  grant: EmbedGrantPayload | null | undefined,
): grant is CatalogEmbedGrantPayload & { adm: true } {
  return isCatalogEmbedGrant(grant) && grant.adm === true;
}

export function publicEmbedSessionFromGrant(
  grant: EmbedGrantPayload | null | undefined,
): { uid: string; catalog: boolean; admin: boolean } | null {
  if (grant == null) return null;
  return {
    uid: grant.uid,
    catalog: isCatalogEmbedGrant(grant),
    admin: isCatalogAdminEmbedGrant(grant),
  };
}

export function projectAcpUserId(project: EmbedGrantProjectRecord | null | undefined): string {
  const metadata = project?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const value = (metadata as { acpUserId?: unknown }).acpUserId;
  return typeof value === 'string' ? value.trim() : '';
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
  if (options.projectId === CATALOG_EMBED_GRANT_PID) {
    const pids = normalizeEmbedGrantProjectIds(options.projectIds);
    if (pids.length > 0) payload.pids = pids;
    if (options.admin === true) payload.adm = true;
  }
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

export function embedGrantQueryPresent(req: EmbedGrantRequestLike): boolean {
  const fromQuery = readQueryParam(req.query, EMBED_GRANT_QUERY);
  return fromQuery !== null && fromQuery.length > 0;
}

/**
 * Session credential is the httpOnly cookie only. A `t` query value must not
 * authenticate API calls or a copied workspace URL.
 */
export function readEmbedGrantFromRequest(req: EmbedGrantRequestLike): string | null {
  const partitioned = readNamedCookie(cookieHeaderValue(req.headers), PARTITIONED_EMBED_GRANT_COOKIE)
    ?? req.cookies?.[PARTITIONED_EMBED_GRANT_COOKIE];
  if (typeof partitioned === 'string') return partitioned.length > 0 ? partitioned : null;
  const fromHeader = readNamedCookie(cookieHeaderValue(req.headers), EMBED_GRANT_COOKIE);
  if (fromHeader !== null) return fromHeader.length > 0 ? fromHeader : null;
  const fromCookies = req.cookies?.[EMBED_GRANT_COOKIE];
  return typeof fromCookies === 'string' && fromCookies.length > 0 ? fromCookies : null;
}

function navigationHeader(req: EmbedGrantRequestLike & {
  get?: (name: string) => string | undefined;
}, name: string): string {
  if (typeof req.get === 'function') {
    const value = req.get(name);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return firstString(req.headers?.[name] ?? req.headers?.[name.toLowerCase()]) ?? '';
}

function refererOrigin(req: EmbedGrantRequestLike & {
  get?: (name: string) => string | undefined;
}): string | null {
  const raw = navigationHeader(req, 'referer').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Parent of a cross-site iframe, when that parent is an operator-listed ACP host. */
function crossSiteEmbedParentAllowed(req: EmbedGrantRequestLike & {
  get?: (name: string) => string | undefined;
}): boolean {
  const origin = refererOrigin(req);
  if (!origin) return false;
  let allowed: string[];
  try {
    allowed = configuredAllowedOrigins();
  } catch {
    return false;
  }
  return allowed.includes(origin);
}

/**
 * `t` may be traded for the httpOnly session only on a browser navigation.
 * Same-site document and iframe loads (ACP SSO return, or the custom-domain
 * Mission) may exchange it. A cross-site iframe may exchange it only when the
 * parent origin is in `OD_ALLOWED_ORIGINS` — the Railway web alias is not
 * schemeful same-site with Studio. The exchange sets the partitioned cookie
 * and the redirect removes `t`. Pasted / Incognito loads send
 * `Sec-Fetch-Site: none`. A cross-site top-level open, or an iframe whose
 * parent is not listed, stays refused. Script cannot set these headers.
 */
export function embedGrantQueryExchangeAllowed(req: EmbedGrantRequestLike & {
  method?: string;
  get?: (name: string) => string | undefined;
}): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const site = navigationHeader(req, 'sec-fetch-site').trim().toLowerCase();
  const mode = navigationHeader(req, 'sec-fetch-mode').trim().toLowerCase();
  const dest = navigationHeader(req, 'sec-fetch-dest').trim().toLowerCase();
  if (mode !== 'navigate') return false;
  if (site === 'same-site') return dest === 'document' || dest === 'iframe';
  if (site === 'cross-site' && dest === 'iframe') return crossSiteEmbedParentAllowed(req);
  return false;
}

/** Relative location with `t` removed. Refuses scheme-relative open redirects. */
export function locationWithoutEmbedGrantQuery(req: {
  originalUrl?: string;
  url?: string;
}): string {
  const raw = (typeof req.originalUrl === 'string' && req.originalUrl.length > 0)
    ? req.originalUrl
    : (typeof req.url === 'string' && req.url.length > 0 ? req.url : '/');
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex < 0 ? raw : raw.slice(0, hashIndex);
  const hash = hashIndex < 0 ? '' : raw.slice(hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex < 0 ? '' : withoutHash.slice(queryIndex + 1));
  params.delete(EMBED_GRANT_QUERY);
  const search = params.toString();
  const safePath = pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.includes('\\') && !pathname.includes('://')
    ? pathname
    : '/';
  return `${safePath}${search.length > 0 ? `?${search}` : ''}${hash}`;
}

export function evaluateEmbedGrantQueryExchange(
  req: EmbedGrantAuthedRequest,
  apiToken: string,
): { ok: false } | { ok: true; token: string; payload: EmbedGrantPayload } {
  if (!embedGrantQueryExchangeAllowed(req)) return { ok: false };
  const token = readQueryParam(req.query, EMBED_GRANT_QUERY);
  if (token == null || token.length === 0) return { ok: false };
  const payload = verifyEmbedGrant(apiToken, token);
  if (!payload) return { ok: false };
  return { ok: true, token, payload };
}

/** HTTPS sessions work inside cross-site embeds without sharing their cookie across top-level sites. */
function embedGrantCookieHeader(
  token: string,
  maxAge: number,
  options?: { secure?: boolean; partitioned?: boolean },
): string {
  const partitioned = options?.secure === true && options.partitioned !== false;
  const parts = [
    `${partitioned ? PARTITIONED_EMBED_GRANT_COOKIE : EMBED_GRANT_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    partitioned ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (options?.secure === true) parts.push('Secure');
  if (partitioned) parts.push('Partitioned');
  return parts.join('; ');
}

function plainCookieHeader(
  name: string,
  value: string,
  maxAge: number,
  options?: { secure?: boolean; httpOnly?: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (options?.httpOnly === true) parts.push('HttpOnly');
  if (options?.secure === true) parts.push('Secure');
  return parts.join('; ');
}

export function setEmbedGrantCookie(
  res: EmbedGrantResponseLike,
  token: string,
  exp: Date | number,
  options?: { secure?: boolean },
): void {
  const maxAge = Math.max(0, Math.floor((expiryUnixMs(exp) - Date.now()) / 1000));
  const header = embedGrantCookieHeader(token, maxAge, options);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', header);
    return;
  }
  res.append?.('Set-Cookie', header);
}

/** Trade a verified same-site `t` for the session cookie, then drop `t` from the URL. */
export function setEmbedGrantExchangeCookies(
  res: EmbedGrantResponseLike,
  token: string,
  exp: Date | number,
  options?: { secure?: boolean },
): void {
  const maxAge = Math.max(0, Math.floor((expiryUnixMs(exp) - Date.now()) / 1000));
  const secure = options?.secure === true;
  const headers = [
    embedGrantCookieHeader(token, maxAge, { secure }),
    plainCookieHeader(EMBED_GRANT_HINT_COOKIE, '1', maxAge, { secure }),
    plainCookieHeader(EMBED_GRANT_HANDOFF_COOKIE, '1', EMBED_GRANT_HANDOFF_MAX_AGE_SEC, {
      secure,
      httpOnly: true,
    }),
  ];
  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', headers);
    return;
  }
  for (const header of headers) res.append?.('Set-Cookie', header);
}

export function embedGrantHandoffPresent(req: EmbedGrantRequestLike): boolean {
  const fromHeader = readNamedCookie(cookieHeaderValue(req.headers), EMBED_GRANT_HANDOFF_COOKIE);
  if (fromHeader === '1') return true;
  return req.cookies?.[EMBED_GRANT_HANDOFF_COOKIE] === '1';
}

export function clearEmbedGrantHandoffCookie(
  res: EmbedGrantResponseLike,
  options?: { secure?: boolean },
): void {
  const header = plainCookieHeader(EMBED_GRANT_HANDOFF_COOKIE, '', 0, {
    secure: options?.secure === true,
    httpOnly: true,
  });
  if (typeof res.append === 'function') {
    res.append('Set-Cookie', header);
    return;
  }
  res.setHeader?.('Set-Cookie', header);
}

export function clearEmbedGrantCookie(
  res: EmbedGrantResponseLike,
  options?: { secure?: boolean },
): void {
  // Expire legacy cookies too, so signing out cannot revive a pre-upgrade session.
  const secure = options?.secure === true;
  const headers = [
    embedGrantCookieHeader('', 0, { ...options, partitioned: false }),
  ];
  if (secure) headers.push(embedGrantCookieHeader('', 0, options));
  headers.push(plainCookieHeader(EMBED_GRANT_HINT_COOKIE, '', 0, { secure }));
  headers.push(plainCookieHeader(EMBED_GRANT_HANDOFF_COOKIE, '', 0, { secure, httpOnly: true }));
  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', headers.length === 1 ? headers[0]! : headers);
    return;
  }
  for (const header of headers) res.append?.('Set-Cookie', header);
}

function isEmbedGrantRunCreatePath(pathname: string): boolean {
  return pathname === '/api/runs' || pathname === '/api/chat';
}

/**
 * Per-session plugin bind used by Community / Home "Use". Not install, trust,
 * or other process-wide mutations — those stay denied for catalog grants.
 */
function isCatalogEmbedPluginUsePath(pathname: string): boolean {
  return /^\/api\/plugins\/[^/]+\/(?:apply|apply-local)$/.test(pathname);
}

/** Settings / onboarding "Test" for the selected CLI. Smoke only — not a host write. */
function isCatalogEmbedConnectionTestPath(pathname: string): boolean {
  return pathname === '/api/test/connection';
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
  if (pathname === CATALOG_EMBED_GRANT_MINT_PATH) return false;

  const catalog = isCatalogEmbedGrant(grant);
  const pathProjectId = projectIdFromPath(pathname);
  if (pathProjectId !== null) {
    if (catalog) return true;
    return embedGrantCoversProjectId(grant, pathProjectId);
  }

  // POST /api/runs and POST /api/chat are the two "create a generation run"
  // entry points. Catalog grants may hit them; project grants need the
  // matching projectId (query here, body in embedGrantForbidsRequest).
  if (isEmbedGrantRunCreatePath(pathname)) {
    return catalog || (queryProjectId != null && embedGrantCoversProjectId(grant, queryProjectId));
  }

  if (!isReadMethod(methodUpper)) {
    if (catalog && methodUpper === 'POST' && pathname === '/api/projects') return true;
    // Community / Home "Use" binds a plugin into the composer via apply.
    // Catalog regulars must be able to do that; install/uninstall/trust stay denied.
    if (catalog && methodUpper === 'POST' && isCatalogEmbedPluginUsePath(pathname)) {
      return true;
    }
    if (catalog && methodUpper === 'POST' && isCatalogEmbedConnectionTestPath(pathname)) {
      return true;
    }
    if (
      catalog
      && grant.adm === true
      && methodUpper === 'PUT'
      && pathname === '/api/app-config'
    ) {
      return true;
    }
    return false;
  }
  if (OPEN_PROBE_PATHS.has(pathname)) return true;
  if (isStudioEmbedReadPath(pathname)) return true;
  return isStudioShellPath(pathname);
}

const DEFERRED_RUN_LOOKUP_PATH = /^\/api\/runs\/([^/]+)(?:\/([^/]+))?$/;
const DEFERRED_RUN_LOOKUP_BLOCKLIST = new Set(['by-plugin-workflow']);
const DEFERRED_RUN_LOOKUP_SUFFIXES = new Set([
  '',
  'agui',
  'cancel',
  'events',
  'result-package',
]);

export type EmbedGrantAuthedRequest = EmbedGrantRequestLike & {
  method?: string;
  originalUrl?: string;
  baseUrl?: string;
  path?: string;
  url?: string;
  secure?: boolean;
  get?: (name: string) => string | undefined;
  body?: unknown;
  embedGrant?: EmbedGrantPayload;
};

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function embedGrantRequestPath(req: {
  originalUrl?: string;
  baseUrl?: string;
  path?: string;
  url?: string;
}): string {
  if (typeof req.originalUrl === 'string' && req.originalUrl.length > 0) {
    return req.originalUrl;
  }
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  if (typeof req.path === 'string' && req.path.length > 0) return `${base}${req.path}`;
  if (typeof req.url === 'string' && req.url.length > 0) return `${base}${req.url}`;
  return '/';
}

export function isEmbedGrantDeferredRunLookupPath(path: string): boolean {
  const { pathname } = splitPath(path);
  const match = DEFERRED_RUN_LOOKUP_PATH.exec(pathname);
  if (!match) return false;
  const id = match[1];
  if (!id || DEFERRED_RUN_LOOKUP_BLOCKLIST.has(id)) return false;
  return DEFERRED_RUN_LOOKUP_SUFFIXES.has(match[2] ?? '');
}

export function embedGrantCookieShouldBeSecure(req: {
  secure?: boolean;
  get?: (name: string) => string | undefined;
  headers?: EmbedGrantRequestLike['headers'];
}): boolean {
  if (req.secure === true) return true;
  const forwarded = typeof req.get === 'function'
    ? req.get('x-forwarded-proto')
    : firstString(req.headers?.['x-forwarded-proto']);
  if (typeof forwarded !== 'string' || forwarded.length === 0) return false;
  return forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
}

function embedGrantAllowsPostRuns(
  grant: EmbedGrantPayload,
  query: Record<string, unknown> | null | undefined,
  body: unknown,
): boolean {
  const bodyProjectId = firstString(jsonRecord(body)?.projectId);
  if (!bodyProjectId) return false;
  if (isCatalogEmbedGrant(grant)) {
    const queryProjectId = firstString(query?.projectId);
    return queryProjectId == null || queryProjectId === bodyProjectId;
  }
  if (!embedGrantCoversProjectId(grant, bodyProjectId)) return false;
  const queryProjectId = firstString(query?.projectId);
  return queryProjectId == null || embedGrantCoversProjectId(grant, queryProjectId);
}

export function embedGrantAllowsProjectRecord(
  grant: EmbedGrantPayload | null | undefined,
  project: EmbedGrantProjectRecord | null | undefined,
): boolean {
  if (grant == null) return true;
  if (project == null || typeof project.id !== 'string' || project.id.length === 0) return false;
  if (embedGrantCoversProjectId(grant, project.id)) return true;
  if (!isCatalogEmbedGrant(grant)) return false;
  return projectAcpUserId(project) === grant.uid;
}

export function embedGrantAllowsProjectId(
  grant: EmbedGrantPayload | null | undefined,
  projectId: unknown,
  project?: EmbedGrantProjectRecord | null,
): boolean {
  if (grant == null) return true;
  if (typeof projectId !== 'string' || projectId.length === 0) return false;
  if (embedGrantCoversProjectId(grant, projectId)) return true;
  if (!isCatalogEmbedGrant(grant)) return false;
  if (project && project.id === projectId) return embedGrantAllowsProjectRecord(grant, project);
  return false;
}

export function filterProjectsForEmbedGrant<T extends EmbedGrantProjectRecord>(
  grant: EmbedGrantPayload | null | undefined,
  projects: readonly T[],
): T[] {
  if (grant == null) return [...projects];
  if (isCatalogEmbedGrant(grant)) {
    return projects.filter((project) => embedGrantAllowsProjectRecord(grant, project));
  }
  return projects.filter((project) => embedGrantCoversProjectId(grant, project.id));
}

export function stampCatalogOwnerMetadata<T extends Record<string, unknown>>(
  metadata: T | null | undefined,
  grant: EmbedGrantPayload | null | undefined,
): T | Record<string, unknown> | null | undefined {
  if (!isCatalogEmbedGrant(grant)) return metadata;
  const base: Record<string, unknown> =
    metadata && typeof metadata === 'object' ? { ...metadata } : {};
  base.acpUserId = grant.uid;
  base.acp = true;
  return base;
}

function collectNamedCookies(header: string, name: string): string[] | null {
  let found = false;
  const values: string[] = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const key = (eq < 0 ? trimmed : trimmed.slice(0, eq)).trim();
    if (key !== name) continue;
    found = true;
    values.push(eq < 0 ? '' : trimmed.slice(eq + 1).trim());
  }
  return found ? values : null;
}

function cookieValues(req: EmbedGrantRequestLike, name: string): string[] | null {
  const fromHeader = collectNamedCookies(cookieHeaderValue(req.headers), name);
  if (fromHeader) return fromHeader;
  const fromJar = req.cookies?.[name];
  if (typeof fromJar === 'string') return [fromJar];
  if (Array.isArray(fromJar)) {
    const values = fromJar.filter((item): item is string => typeof item === 'string');
    return values.length > 0 ? values : [''];
  }
  return null;
}

function verifiedEmbedSessions(
  apiToken: string,
  tokens: readonly string[] | null,
): Array<{ token: string; payload: EmbedGrantPayload }> {
  if (!tokens) return [];
  const sessions: Array<{ token: string; payload: EmbedGrantPayload }> = [];
  for (const token of tokens) {
    if (!token) continue;
    const payload = verifyEmbedGrant(apiToken, token);
    if (payload) sessions.push({ token, payload });
  }
  return sessions;
}

/**
 * Session credential is still the httpOnly cookie, never `t`.
 *
 * HTTPS embeds also carry `__Host-od_embed_partitioned` from an earlier
 * same-site exchange. That cookie wins when it authorizes this request. A
 * verified but too-narrow partitioned grant must not hide the `od_embed`
 * cookie Agent Control Panel set for the project the iframe is opening.
 * A present partitioned cookie that does not verify still fails closed, so a
 * dead partition cannot revive `od_embed`.
 */
export function applyVerifiedEmbedGrant(
  req: EmbedGrantAuthedRequest,
  res: EmbedGrantResponseLike,
  apiToken: string,
  lookup?: EmbedGrantProjectLookup | null,
): EmbedGrantPayload | null {
  const partitionedTokens = cookieValues(req, PARTITIONED_EMBED_GRANT_COOKIE);
  const legacyTokens = cookieValues(req, EMBED_GRANT_COOKIE);
  let sessions: Array<{ token: string; payload: EmbedGrantPayload }>;
  if (partitionedTokens) {
    const partitioned = verifiedEmbedSessions(apiToken, partitionedTokens);
    if (partitioned.length === 0) return null;
    sessions = [...partitioned, ...verifiedEmbedSessions(apiToken, legacyTokens)];
  } else {
    sessions = verifiedEmbedSessions(apiToken, legacyTokens);
  }
  if (sessions.length === 0) return null;
  const chosen = sessions.find((session) => (
    !embedGrantForbidsRequest(session.payload, req, lookup)
  )) ?? sessions[0]!;
  req.embedGrant = chosen.payload;
  setEmbedGrantCookie(res, chosen.token, chosen.payload.exp, {
    secure: embedGrantCookieShouldBeSecure(req),
  });
  return chosen.payload;
}

export function embedGrantForbidsRequest(
  grant: EmbedGrantPayload,
  req: EmbedGrantAuthedRequest,
  lookup?: EmbedGrantProjectLookup | null,
): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = embedGrantRequestPath(req);
  const { pathname } = splitPath(path);
  if (isEmbedGrantDeferredRunLookupPath(pathname)) return false;
  if (method === 'POST' && isEmbedGrantRunCreatePath(pathname)) {
    if (!embedGrantAllowsPostRuns(grant, req.query, req.body)) return true;
    if (!isCatalogEmbedGrant(grant)) return false;
    const bodyProjectId = firstString(jsonRecord(req.body)?.projectId);
    if (!lookup) return true;
    return !embedGrantAllowsProjectRecord(
      grant,
      bodyProjectId ? lookup(bodyProjectId) : null,
    );
  }
  if (!embedGrantAllowsPath(grant, method, path, req.query ?? null)) return true;
  const pathProjectId = projectIdFromPath(pathname);
  if (isCatalogEmbedGrant(grant) && pathProjectId) {
    if (!lookup) return true;
    return !embedGrantAllowsProjectRecord(grant, lookup(pathProjectId));
  }
  return false;
}

declare global {
  namespace Express {
    interface Request {
      embedGrant?: EmbedGrantPayload;
    }
  }
}
