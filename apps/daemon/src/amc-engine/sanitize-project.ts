const STRIP_KEYS = new Set([
  'pendingPrompt',
  'pending_prompt',
  'amcGrok',
  'amcGrokHome',
  'amcCredential',
  'authJson',
  'grokAuthJson',
]);

function stripRecord(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (STRIP_KEYS.has(key)) continue;
    if (key === 'metadata' && nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const meta = { ...(nested as Record<string, unknown>) };
      for (const strip of STRIP_KEYS) delete meta[strip];
      delete meta.amcGrokHome;
      out[key] = meta;
      continue;
    }
    out[key] = nested;
  }
  return out;
}

export function sanitizeProjectForGrant<T>(project: T): T {
  return stripRecord(project) as T;
}
