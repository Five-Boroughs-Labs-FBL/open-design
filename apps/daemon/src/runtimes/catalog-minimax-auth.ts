import fs from 'node:fs';
import path from 'node:path';

import {
  isSafeCatalogUserId,
  resolveCatalogAcpBeBaseUrl,
} from './catalog-grok-auth.js';

export const DEFAULT_CATALOG_MINIMAX_MODEL = 'MiniMax-M2.7-highspeed';
export const DEFAULT_CATALOG_MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic';

export type CatalogMinimaxAuth = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function catalogMinimaxFile(dataDir: string, userId: string): string {
  return path.join(dataDir, 'catalog-minimax', `${userId}.json`);
}

export function sanitizeCatalogMinimaxModel(raw: string | null | undefined): string {
  const model = String(raw || '').trim();
  if (model === 'MiniMax-M3' || model === 'MiniMax-M2.7-highspeed') return model;
  if (model === 'MiniMax-M2.7') return 'MiniMax-M2.7-highspeed';
  return DEFAULT_CATALOG_MINIMAX_MODEL;
}

export function isCatalogMinimaxByok(
  provider: { baseUrl?: unknown; model?: unknown } | null | undefined,
  model?: unknown,
): boolean {
  const url = String(provider?.baseUrl || '').toLowerCase();
  const mid = String(provider?.model || model || '');
  return url.includes('minimax') || /^minimax/i.test(mid);
}

export function rememberCatalogMinimaxAuth(
  dataDir: string,
  userId: string,
  auth: { apiKey?: unknown; baseUrl?: unknown; model?: unknown },
): CatalogMinimaxAuth {
  const uid = String(userId || '').trim();
  const apiKey = String(auth.apiKey || '').trim();
  if (!isSafeCatalogUserId(uid)) {
    throw new Error('catalog MiniMax userId is invalid');
  }
  if (!apiKey) {
    throw new Error('catalog MiniMax apiKey is required');
  }
  const root = String(dataDir || '').trim();
  if (!root || path.isAbsolute(root) === false) {
    throw new Error('catalog MiniMax remember requires an absolute dataDir');
  }
  const stored: CatalogMinimaxAuth = {
    apiKey,
    baseUrl: String(auth.baseUrl || '').trim() || DEFAULT_CATALOG_MINIMAX_BASE_URL,
    model: sanitizeCatalogMinimaxModel(typeof auth.model === 'string' ? auth.model : ''),
  };
  const dir = path.join(root, 'catalog-minimax');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(catalogMinimaxFile(root, uid), JSON.stringify(stored), { mode: 0o600 });
  return stored;
}

export function readCatalogMinimaxAuth(
  dataDir: string,
  userId: string,
): CatalogMinimaxAuth | null {
  const uid = String(userId || '').trim();
  if (!isSafeCatalogUserId(uid)) return null;
  const root = String(dataDir || '').trim();
  if (!root || path.isAbsolute(root) === false) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogMinimaxFile(root, uid), 'utf8')) as {
      apiKey?: unknown;
      baseUrl?: unknown;
      model?: unknown;
    };
    const apiKey = String(parsed.apiKey || '').trim();
    if (!apiKey) return null;
    return {
      apiKey,
      baseUrl: String(parsed.baseUrl || '').trim() || DEFAULT_CATALOG_MINIMAX_BASE_URL,
      model: sanitizeCatalogMinimaxModel(typeof parsed.model === 'string' ? parsed.model : ''),
    };
  } catch {
    return null;
  }
}

export async function fetchCatalogMinimaxAuthFromAcp(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CatalogMinimaxAuth | null> {
  const uid = String(userId || '').trim();
  const base = resolveCatalogAcpBeBaseUrl(env);
  const token = String(env.OD_API_TOKEN || '').trim();
  if (!uid || !base || !token) return null;
  const url = new URL('/api/open-design/minimax-auth', `${base}/`);
  url.searchParams.set('userId', uid);
  try {
    const resp = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as {
      apiKey?: unknown;
      baseUrl?: unknown;
      model?: unknown;
    };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) return null;
    return {
      apiKey,
      baseUrl: typeof body.baseUrl === 'string' && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : DEFAULT_CATALOG_MINIMAX_BASE_URL,
      model: sanitizeCatalogMinimaxModel(
        typeof body.model === 'string' ? body.model : '',
      ),
    };
  } catch {
    return null;
  }
}

export async function resolveCatalogMinimaxAuth(
  dataDir: string,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CatalogMinimaxAuth | null> {
  const stored = readCatalogMinimaxAuth(dataDir, userId);
  if (stored) return stored;
  const pulled = await fetchCatalogMinimaxAuthFromAcp(userId, env);
  if (!pulled) return null;
  try {
    return rememberCatalogMinimaxAuth(dataDir, userId, pulled);
  } catch {
    return pulled;
  }
}

export function mergeCatalogMinimaxByok<
  T extends { protocol?: string; apiKey?: string; baseUrl?: string; model?: string },
>(
  provider: T | null | undefined,
  packed: CatalogMinimaxAuth,
): T & { protocol: string; apiKey: string; baseUrl: string; model: string } {
  return {
    ...(provider ?? ({} as T)),
    protocol: provider?.protocol || 'anthropic',
    apiKey: String(provider?.apiKey || '').trim() || packed.apiKey,
    baseUrl: String(provider?.baseUrl || '').trim() || packed.baseUrl,
    model: packed.model || String(provider?.model || '').trim() || DEFAULT_CATALOG_MINIMAX_MODEL,
  };
}
