import fs from 'node:fs';
import path from 'node:path';

export type AmcGrokForwarding = {
  sessionId: string;
  grokHome: string;
  sourceCwd: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Allowlisted AMC → OD Grok handoff. Rejects extra env and non-directory homes.
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
  if (!sessionId && !grokHome && !sourceCwd) return null;
  if (!grokHome) {
    throw new Error('amcGrok requires grokHome');
  }
  if (path.isAbsolute(grokHome) === false) {
    throw new Error('amcGrok.grokHome must be an absolute directory');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(grokHome);
  } catch {
    throw new Error('grok_home_unreachable');
  }
  if (!stat.isDirectory()) {
    throw new Error('grok_home_unreachable');
  }
  return { sessionId, grokHome, sourceCwd };
}

export function applyAmcGrokHome(
  env: NodeJS.ProcessEnv,
  forwarding: AmcGrokForwarding | null | undefined,
): NodeJS.ProcessEnv {
  if (!forwarding || !forwarding.grokHome) return env;
  return { ...env, GROK_HOME: forwarding.grokHome };
}
