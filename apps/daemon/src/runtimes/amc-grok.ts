import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type AmcGrokForwarding = {
  sessionId: string;
  grokHome: string;
  sourceCwd: string;
  apiKey?: string;
  authJson?: string;
};

const MAX_AUTH_JSON_BYTES = 200_000;
const API_KEY_FILE = '.amc-api-key';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isExistingDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Allowlisted AMC → OD Grok handoff. Rejects extra env. Grok home may be an
 * AMC-BE path that does not exist on this host — credentials travel as
 * apiKey / authJson and are materialized under OD_DATA_DIR.
 */
export function parseAmcGrokBlock(raw: unknown): AmcGrokForwarding | null {
  if (raw == null) return null;
  const rec = asRecord(raw);
  if (!rec) {
    throw new Error('amcGrok must be an object');
  }
  const sessionId = String(rec.sessionId || '').trim();
  const grokHome = String(rec.grokHome || '').trim();
  const sourceCwd = String(rec.sourceCwd || '').trim();
  const apiKey = String(rec.apiKey || '').trim();
  const authJson = String(rec.authJson || '').trim();
  if (!sessionId && !grokHome && !sourceCwd && !apiKey && !authJson) return null;
  if (authJson && Buffer.byteLength(authJson, 'utf8') > MAX_AUTH_JSON_BYTES) {
    throw new Error('amcGrok.authJson is too large');
  }
  if (authJson) {
    try {
      const parsed = JSON.parse(authJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('amcGrok.authJson must be a JSON object');
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('amcGrok.authJson')) throw err;
      throw new Error('amcGrok.authJson must be valid JSON');
    }
  }
  if (!apiKey && !authJson) {
    if (!grokHome) {
      throw new Error('amcGrok requires grokHome');
    }
    if (path.isAbsolute(grokHome) === false) {
      throw new Error('amcGrok.grokHome must be an absolute directory');
    }
    if (!isExistingDirectory(grokHome)) {
      throw new Error('grok_home_unreachable');
    }
  } else if (grokHome && path.isAbsolute(grokHome) === false) {
    throw new Error('amcGrok.grokHome must be an absolute directory');
  }
  const forwarding: AmcGrokForwarding = { sessionId, grokHome, sourceCwd };
  if (apiKey) forwarding.apiKey = apiKey;
  if (authJson) forwarding.authJson = authJson;
  return forwarding;
}

export function materializeAmcGrokHome(
  dataDir: string,
  forwarding: AmcGrokForwarding,
): AmcGrokForwarding {
  if (!forwarding.apiKey && !forwarding.authJson && isExistingDirectory(forwarding.grokHome)) {
    return forwarding;
  }
  const root = String(dataDir || '').trim();
  if (!root || path.isAbsolute(root) === false) {
    throw new Error('amcGrok materialize requires an absolute dataDir');
  }
  const seed = forwarding.authJson || forwarding.apiKey || forwarding.grokHome || 'amc';
  const id = createHash('sha256').update(seed).digest('hex').slice(0, 16);
  const home = path.join(root, 'amc-grok-homes', id);
  fs.mkdirSync(home, { recursive: true });
  if (forwarding.authJson) {
    fs.writeFileSync(path.join(home, 'auth.json'), forwarding.authJson, { mode: 0o600 });
  }
  if (forwarding.apiKey) {
    fs.writeFileSync(path.join(home, API_KEY_FILE), forwarding.apiKey, { mode: 0o600 });
  }
  return { ...forwarding, grokHome: home };
}

function readMaterializedApiKey(grokHome: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  try {
    return fs.readFileSync(path.join(grokHome, API_KEY_FILE), 'utf8').trim();
  } catch {
    return '';
  }
}

export function applyAmcGrokHome(
  env: NodeJS.ProcessEnv,
  forwarding: AmcGrokForwarding | null | undefined,
): NodeJS.ProcessEnv {
  if (!forwarding || !forwarding.grokHome) return env;
  const next: NodeJS.ProcessEnv = { ...env, GROK_HOME: forwarding.grokHome };
  const apiKey = readMaterializedApiKey(forwarding.grokHome, forwarding.apiKey);
  if (apiKey) {
    next.GROK_CODE_XAI_API_KEY = apiKey;
    next.XAI_API_KEY = apiKey;
  }
  return next;
}
