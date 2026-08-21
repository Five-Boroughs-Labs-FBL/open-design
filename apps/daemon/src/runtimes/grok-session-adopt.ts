import fs from 'node:fs';
import path from 'node:path';

export type AdoptGrokSessionInput = {
  grokHome: string;
  sessionId: string;
  sourceCwd?: string | null;
  targetCwd: string;
};

export type AdoptGrokSessionResult = {
  copied: boolean;
  sourceDir: string;
  targetDir: string;
};

function grokSessionDir(grokHome: string, cwd: string, sessionId: string): string {
  return path.join(String(grokHome), 'sessions', encodeURIComponent(String(cwd)), String(sessionId));
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9._:-]+$/.test(sessionId) && !sessionId.includes('..');
}

function findSessionDir(grokHome: string, sessionId: string): string | null {
  const root = path.join(grokHome, 'sessions');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, sessionId);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}

/**
 * Grok stores transcripts at `<GROK_HOME>/sessions/<urlencoded-cwd>/<id>/`.
 * AMC planner cwd and the OD project cwd almost never match. Copy (never move)
 * the session directory to the target cwd key so `--resume <id>` can see it.
 * Missing id fails closed — callers must not start a second Grok login.
 */
export function adoptGrokSession(input: AdoptGrokSessionInput): AdoptGrokSessionResult {
  const grokHome = path.resolve(String(input.grokHome || '').trim());
  const sessionId = String(input.sessionId || '').trim();
  const targetCwd = String(input.targetCwd || '').trim();
  if (!grokHome || !sessionId || !targetCwd) {
    throw new Error('grok session adopt requires grokHome, sessionId, and targetCwd');
  }
  if (!isSafeSessionId(sessionId)) {
    throw new Error('grok session id is not adoptable');
  }
  let homeStat: fs.Stats;
  try {
    homeStat = fs.statSync(grokHome);
  } catch {
    throw new Error('grok_home_unreachable');
  }
  if (!homeStat.isDirectory()) {
    throw new Error('grok_home_unreachable');
  }

  const targetDir = grokSessionDir(grokHome, targetCwd, sessionId);
  try {
    if (fs.statSync(targetDir).isDirectory()) {
      return { copied: false, sourceDir: targetDir, targetDir };
    }
  } catch {
    // target missing — copy
  }

  let sourceDir = '';
  const sourceCwd = String(input.sourceCwd || '').trim();
  if (sourceCwd) {
    sourceDir = grokSessionDir(grokHome, sourceCwd, sessionId);
  }
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    sourceDir = findSessionDir(grokHome, sessionId) || sourceDir;
  }
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    throw new Error('session_transcript_missing');
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, errorOnExist: false, force: false });
  return { copied: true, sourceDir, targetDir };
}

export function grokSessionDirForTest(grokHome: string, cwd: string, sessionId: string): string {
  return grokSessionDir(grokHome, cwd, sessionId);
}
