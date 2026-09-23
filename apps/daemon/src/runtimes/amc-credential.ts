import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Generic AMC → Open Design credential handoff.
 *
 * AMC owns the credential vault; Open Design owns how to spawn a CLI. This is
 * the seam between those two facts: AMC sends the already-resolved secret for
 * one provider family, OD injects it into that run's spawn environment and
 * nothing else.
 *
 * Why this exists next to `amc-grok.ts` rather than replacing it: Grok needs a
 * materialized GROK_HOME directory with an `auth.json` on disk, which is a
 * genuinely grok-shaped problem. Codex also needs a private auth.json, which
 * this module materializes from its allowlisted envelope. Cursor and Muse use
 * plain environment variables.
 *
 * Add a family to both the allowlist and agent map, then handle any file-backed
 * authentication explicitly before spawning it.
 *
 * Security: this preserves `amc-grok.ts`'s "rejects extra env" property. The
 * caller cannot name the variables — only values for a fixed, per-family set of
 * keys are accepted, so a compromised or buggy caller cannot inject PATH,
 * LD_PRELOAD, NODE_OPTIONS or an endpoint override for a family that has no
 * business setting one. The route additionally gates the whole block behind the
 * OD server API token.
 */

export type AmcCredential = {
  family: string;
  env: Record<string, string>;
};

/**
 * The ONLY environment variables each family may set, and the exact names the
 * corresponding CLI already reads.
 *
 *   cursor  CURSOR_API_KEY   — cursor-agent's documented automation variable
 *                              (see runtimes/auth.ts's Cursor guidance string)
 *   muse    META_API_KEY     — Muse Code; AMC extracts this from the packed
 *                              subscription auth.json (or a pasted API key)
 *
 * Families are registered here as they are wired end-to-end, not speculatively:
 * an unused allowlist entry is unused attack surface. Claude and MiniMax both
 * ride ANTHROPIC_* and should be added together with the AMC side that sends
 * them.
 */
const ENV_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  cursor: Object.freeze(['CURSOR_API_KEY']),
  muse: Object.freeze(['META_API_KEY']),
  codex: Object.freeze(['CODEX_AUTH_JSON']),
});

/**
 * Which OD agent ids a family is allowed to drive. This is what replaces
 * `def.id === 'grok-build'` as the gate: a cursor credential must not be
 * injected into a claude spawn just because the caller asked for it.
 */
const FAMILY_AGENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  cursor: Object.freeze(['cursor-agent']),
  muse: Object.freeze(['muse']),
  codex: Object.freeze(['codex']),
});

const MAX_VALUE_BYTES = 8_192;
const MAX_CODEX_AUTH_BYTES = 200_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Families this daemon build can accept. Exported for diagnostics/tests. */
export function supportedAmcCredentialFamilies(): string[] {
  return Object.keys(ENV_ALLOWLIST).sort();
}

/**
 * Validate an `amcCredential` block from POST /api/runs.
 *
 * Returns null when absent. Throws (→ 400) when present but malformed, so a
 * caller sending a credential AMC believes is required never silently runs
 * unauthenticated against the daemon's own ambient environment.
 */
export function parseAmcCredentialBlock(raw: unknown): AmcCredential | null {
  if (raw == null) return null;
  const rec = asRecord(raw);
  if (!rec) {
    throw new Error('amcCredential must be an object');
  }

  const family = String(rec.family || '').trim().toLowerCase();
  if (!family) {
    throw new Error('amcCredential requires family');
  }
  const allowed = ENV_ALLOWLIST[family];
  if (!allowed) {
    throw new Error(
      `amcCredential family "${family}" is not supported by this ACP Design build`,
    );
  }

  const envRec = asRecord(rec.env);
  if (!envRec) {
    throw new Error('amcCredential.env must be an object');
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRec)) {
    if (!allowed.includes(key)) {
      throw new Error(`amcCredential.env key "${key}" is not allowed for family "${family}"`);
    }
    if (typeof value !== 'string') {
      throw new Error(`amcCredential.env.${key} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (Buffer.byteLength(trimmed, 'utf8') > (key === 'CODEX_AUTH_JSON' ? MAX_CODEX_AUTH_BYTES : MAX_VALUE_BYTES)) {
      throw new Error(`amcCredential.env.${key} is too large`);
    }
    if (key === 'CODEX_AUTH_JSON') {
      try {
        if (!asRecord(JSON.parse(trimmed))) throw new Error('invalid');
      } catch {
        throw new Error('amcCredential.env.CODEX_AUTH_JSON must be a JSON object');
      }
    }
    env[key] = trimmed;
  }

  // An envelope that carries nothing is a caller bug, not a no-op: the run
  // would fall through to the daemon's ambient environment and bill whoever
  // that belongs to. Refuse it rather than silently crossing that boundary.
  if (Object.keys(env).length === 0) {
    throw new Error(`amcCredential for family "${family}" carried no credential values`);
  }

  return { family, env };
}

/** Is this credential permitted to drive this agent? */
export function amcCredentialMatchesAgent(
  credential: AmcCredential | null | undefined,
  agentId: string,
): boolean {
  if (!credential) return false;
  const agents = FAMILY_AGENTS[credential.family];
  if (!agents) return false;
  return agents.includes(String(agentId || '').trim());
}

/**
 * Apply the credential to a spawn environment.
 *
 * Applied AFTER `spawnEnvForAgent` for the same reason `configuredEnv` wins
 * there: an AMC-supplied credential is the explicit instruction for this run
 * and must beat whatever the daemon host happens to have in its own
 * environment. Otherwise an ambient key on the OD host silently bills the
 * wrong account.
 */
export function applyAmcCredential(
  env: NodeJS.ProcessEnv,
  credential: AmcCredential | null | undefined,
  agentId: string,
  dataDir?: string,
): NodeJS.ProcessEnv {
  if (!amcCredentialMatchesAgent(credential, agentId)) return env;
  if (credential?.family === 'codex') {
    if (!dataDir) throw new Error('Codex credential requires a daemon dataDir');
    const authJson = credential.env.CODEX_AUTH_JSON;
    if (!authJson) throw new Error('Codex credential requires CODEX_AUTH_JSON');
    const home = materializeAmcCodexHome(dataDir, authJson);
    const next: NodeJS.ProcessEnv = { ...env, CODEX_HOME: home };
    // The forwarded subscription must not silently fall through to an
    // unrelated API key configured on the Open Design service.
    delete next.CODEX_API_KEY;
    delete next.OPENAI_API_KEY;
    delete next.CODEX_ACCESS_TOKEN;
    return next;
  }
  return { ...env, ...(credential as AmcCredential).env };
}

/** Preserve the CLI's refreshed login across every turn of this project. */
export function materializeAmcCodexHome(dataDir: string, authJson: string): string {
  if (!path.isAbsolute(dataDir) || !authJson || !asRecord(JSON.parse(authJson))) {
    throw new Error('invalid Codex credential home');
  }
  const id = createHash('sha256').update(authJson).digest('hex').slice(0, 32);
  const home = path.join(dataDir, 'amc-codex-homes', id);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, 'auth.json');
  try {
    fs.writeFileSync(file, authJson, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return home;
}

/**
 * Attach AMC-forwarded credentials onto a newly created run.
 *
 * These two blocks are independent on purpose. Grok travels as `amcGrok`
 * (a packed auth.json, no env key). Cursor travels as `amcCredential` and
 * never sends `amcGrok`. Nesting the generic envelope under `parsedAmcGrok`
 * discarded every Cursor key and let the spawn fall through to the daemon's
 * ambient environment.
 */
export function attachAmcRunCredentials<
  T extends { amcGrok?: unknown; amcCredential?: AmcCredential | null },
>(
  run: T,
  blocks: {
    amcGrok?: unknown | null;
    amcCredential?: AmcCredential | null;
  },
): T {
  if (blocks.amcGrok) run.amcGrok = blocks.amcGrok;
  if (blocks.amcCredential) run.amcCredential = blocks.amcCredential;
  return run;
}


/**
 * Persist a credential for later turns of the same project.
 *
 * A studio follow-up (the owner typing in the Open Design canvas) creates a
 * run AMC never saw, so it carries no envelope. Without this the follow-up
 * would fall through to the daemon's ambient environment and either fail
 * unauthenticated or bill the wrong account.
 *
 * Same posture as `amc-grok.ts`: the secret goes to a 0600 file under
 * OD_DATA_DIR and only the PATH is recorded in project metadata, so it never
 * lands in the database or in any API response.
 */
export function materializeAmcCredential(dataDir: string, credential: AmcCredential): string {
  const root = String(dataDir || '').trim();
  if (!root || path.isAbsolute(root) === false) {
    throw new Error('amcCredential materialize requires an absolute dataDir');
  }
  const id = createHash('sha256')
    .update(`${credential.family}:${JSON.stringify(credential.env)}`)
    .digest('hex')
    .slice(0, 16);
  const dir = path.join(root, 'amc-credentials');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${credential.family}-${id}.json`);
  fs.writeFileSync(file, JSON.stringify(credential), { mode: 0o600 });
  return file;
}

/**
 * Rehydrate a persisted credential. Re-validated through the same allowlist
 * as the wire format, so a file written by an older build whose family this
 * build no longer supports is refused rather than injected blindly.
 */
export function readAmcCredentialFile(filePath: unknown): AmcCredential | null {
  const file = String(filePath || '').trim();
  if (!file || path.isAbsolute(file) === false) return null;
  try {
    return parseAmcCredentialBlock(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}
