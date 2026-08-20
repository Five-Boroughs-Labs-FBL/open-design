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
