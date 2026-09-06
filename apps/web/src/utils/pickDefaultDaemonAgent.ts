export type PickableDaemonAgent = {
  id: string;
  available?: boolean;
  authStatus?: "ok" | "missing" | "unknown";
};

/**
 * Choose a daemon CLI to run when the user has not picked one yet.
 * Prefer an installed agent that is already authenticated so Send does not
 * bounce on "pick a local agent" / missing login.
 */
export function pickDefaultDaemonAgent<T extends PickableDaemonAgent>(
  agents: T[],
): T | undefined {
  const available = agents.filter((agent) => agent.available);
  if (available.length === 0) return undefined;
  return available.find((agent) => agent.authStatus === "ok") ?? available[0];
}

/**
 * Hosted ACP Studio has no terminal for `grok login`. Prefer an already-
 * authenticated CLI (typically the host AMR/vela session). Keep a confirmed-ok
 * current pick; replace a missing-auth (or empty) slot.
 */
export function resolveAcpStudioDaemonAgent<T extends PickableDaemonAgent>(
  agents: T[],
  currentId?: string | null,
): T | undefined {
  const picked = pickDefaultDaemonAgent(agents);
  if (!currentId) return picked;
  const current = agents.find((agent) => agent.id === currentId);
  if (current?.available && current.authStatus === "ok") return current;
  if (
    current?.available
    && current.authStatus !== "missing"
    && picked?.authStatus !== "ok"
  ) {
    return current;
  }
  return picked ?? (current?.available ? current : undefined);
}
