import fs from 'node:fs';
import path from 'node:path';

import { acpSsoUrlFromEnv } from '../acp-sso.js';
import {
  applyAmcGrokHome,
  parseAmcGrokBlock,
  type AmcGrokForwarding,
} from './amc-grok.js';

const USER_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function catalogGrokHomeDir(dataDir: string, userId: string): string {
  return path.join(dataDir, 'catalog-grok-homes', userId);
}

export function isSafeCatalogUserId(userId: string): boolean {
  return USER_ID_RE.test(userId);
}

/**
 * Persist the ACP vault SuperGrok auth.json for a catalog user under the
 * daemon data root. Host XAI_API_KEY is not stored — SuperGrok is auth.json.
 */
export function rememberCatalogGrokAuth(
  dataDir: string,
  userId: string,
  authJson: string,
): AmcGrokForwarding {
  const uid = String(userId || '').trim();
  const json = String(authJson || '').trim();
  if (!isSafeCatalogUserId(uid)) {
    throw new Error('catalog grok userId is invalid');
  }
  const parsed = parseAmcGrokBlock({ authJson: json });
  if (!parsed?.authJson) {
    throw new Error('catalog grok authJson is required');
  }
  const root = String(dataDir || '').trim();
  if (!root || path.isAbsolute(root) === false) {
    throw new Error('catalog grok remember requires an absolute dataDir');
  }
  const home = catalogGrokHomeDir(root, uid);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, 'auth.json'), parsed.authJson, { mode: 0o600 });
  return {
    sessionId: '',
    grokHome: home,
    sourceCwd: '',
    authJson: parsed.authJson,
  };
}

export function readCatalogGrokAuth(
  dataDir: string,
  userId: string,
): AmcGrokForwarding | null {
  const uid = String(userId || '').trim();
  if (!isSafeCatalogUserId(uid)) return null;
  const root = String(dataDir || '').trim();
  if (!root || path.isAbsolute(root) === false) return null;
  const home = catalogGrokHomeDir(root, uid);
  const authPath = path.join(home, 'auth.json');
  try {
    const authJson = fs.readFileSync(authPath, 'utf8');
    return parseAmcGrokBlock({ grokHome: home, authJson });
  } catch {
    return null;
  }
}

function acpBeBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (
    env.OD_ACP_BE_URL
    || env.RAILWAY_SERVICE_ACP_BE_URL
    || ''
  ).trim();
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '');
    return `http://${raw.replace(/\/$/, '')}`;
  }
  const sso = acpSsoUrlFromEnv(env);
  if (!sso) return '';
  try {
    return new URL(sso).origin;
  } catch {
    return '';
  }
}

/**
 * Pull the catalog user's SuperGrok auth.json from ACP when SSO did not
 * push it (session already open). Same Bearer as AMC → OD mint.
 */
export async function fetchCatalogGrokAuthFromAcp(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const uid = String(userId || '').trim();
  const base = acpBeBaseUrl(env);
  const token = String(env.OD_API_TOKEN || '').trim();
  if (!uid || !base || !token) return '';
  const url = new URL('/api/open-design/grok-auth', `${base}/`);
  url.searchParams.set('userId', uid);
  try {
    const resp = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return '';
    const body = (await resp.json()) as { authJson?: unknown };
    return typeof body.authJson === 'string' ? body.authJson.trim() : '';
  } catch {
    return '';
  }
}

export async function resolveCatalogGrokForwarding(
  dataDir: string,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AmcGrokForwarding | null> {
  const stored = readCatalogGrokAuth(dataDir, userId);
  if (stored) return stored;
  const authJson = await fetchCatalogGrokAuthFromAcp(userId, env);
  if (!authJson) return null;
  try {
    return rememberCatalogGrokAuth(dataDir, userId, authJson);
  } catch {
    return null;
  }
}

export function applyCatalogGrokLaunchEnv(
  env: NodeJS.ProcessEnv,
  forwarding: AmcGrokForwarding | null | undefined,
): NodeJS.ProcessEnv {
  return applyAmcGrokHome(env, forwarding);
}
