import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { amcEngineStudioSecret } from './profile.js';

export const DEFAULT_LAUNCH_GRANT_TTL_SEC = 90;
const MAX_LAUNCH_GRANT_TTL_SEC = 120;
const FIELD_SEP = '~';

type ConsumedGrant = { expMs: number; projectId: string };
const consumed = new Map<string, ConsumedGrant>();

export type LaunchGrantPayload = {
  jti: string;
  projectId: string;
  userId: string;
  exp: string;
};

export type LaunchGrantVerifyOk = { ok: true } & LaunchGrantPayload;
export type LaunchGrantVerifyFail = { ok: false; reason: string };
export type LaunchGrantVerify = LaunchGrantVerifyOk | LaunchGrantVerifyFail;

function timingSafeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sign(secret: string, parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\n')).digest('base64url');
}

export function resetAmcLaunchGrantsForTests(): void {
  consumed.clear();
}

function prune(now: number): void {
  for (const [jti, row] of consumed) {
    if (row.expMs <= now) consumed.delete(jti);
  }
}

export function mintAmcLaunchGrant(input: {
  projectId: string;
  userId: string;
  ttlSec?: number;
  now?: number;
  secret?: string;
}): { token: string; expiresAt: string; projectId: string; userId: string } {
  const projectId = String(input.projectId || '').trim();
  const userId = String(input.userId || '').trim();
  if (!projectId) throw new Error('projectId required');
  if (!userId) throw new Error('userId required');
  const secret = String(input.secret || amcEngineStudioSecret()).trim();
  if (!secret) throw new Error('OD_AMC_STUDIO_SECRET or OD_API_TOKEN required');
  const ttl = Number(input.ttlSec);
  const ttlSec = Number.isFinite(ttl) && ttl > 0
    ? Math.min(Math.floor(ttl), MAX_LAUNCH_GRANT_TTL_SEC)
    : DEFAULT_LAUNCH_GRANT_TTL_SEC;
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const expMs = now + ttlSec * 1000;
  const exp = new Date(expMs).toISOString();
  const jti = randomBytes(16).toString('hex');
  const signature = sign(secret, [jti, projectId, userId, exp]);
  const token = [jti, projectId, userId, exp, signature].join(FIELD_SEP);
  return { token, expiresAt: exp, projectId, userId };
}

export function verifyAmcLaunchGrant(
  token: string,
  options: { now?: number; secret?: string } = {},
): LaunchGrantVerify {
  const secret = String(options.secret || amcEngineStudioSecret()).trim();
  if (!secret) return { ok: false, reason: 'secret missing' };
  const raw = String(token || '');
  const parts = raw.split(FIELD_SEP);
  if (parts.length !== 5) return { ok: false, reason: 'token shape invalid' };
  const [jti, projectId, userId, exp, signature] = parts as [string, string, string, string, string];
  if (!jti || !projectId || !userId || !exp || !signature) {
    return { ok: false, reason: 'token shape invalid' };
  }
  const expected = sign(secret, [jti, projectId, userId, exp]);
  if (!timingSafeStringEquals(expected, signature)) {
    return { ok: false, reason: 'token signature invalid' };
  }
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const expMs = Date.parse(exp);
  if (!Number.isFinite(expMs)) return { ok: false, reason: 'token expiry invalid' };
  if (expMs <= now) return { ok: false, reason: 'token expired' };
  prune(now);
  if (consumed.has(jti)) return { ok: false, reason: 'token nonce already used' };
  return { ok: true, jti, projectId, userId, exp };
}

export function consumeAmcLaunchGrant(verified: LaunchGrantPayload, now = Date.now()): boolean {
  prune(now);
  if (consumed.has(verified.jti)) return false;
  consumed.set(verified.jti, {
    expMs: Date.parse(verified.exp) || now,
    projectId: verified.projectId,
  });
  return true;
}
