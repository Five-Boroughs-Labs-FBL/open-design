/**
 * Retry must keep the failed turn's CLI family.
 *
 * Cursor can run vendor model ids (grok-4.6, claude-opus-5, gpt-5.6-sol).
 * Catalog Studio's grok latch and the Default CLI picker both treat
 * `grok-4.6` as "switch to grok-build". Builder already refuses that steal
 * (`alignProviderToModel` leaves Cursor alone). A Design Retry that failed
 * as cursor-agent must not come back as Grok Build just because the Cursor
 * model id looks like Grok.
 */

export function modelIdFromAgentDisplayName(
  agentName?: string | null,
): string | null {
  const name = String(agentName || '');
  const sep = ' · ';
  const at = name.lastIndexOf(sep);
  if (at < 0) return null;
  const model = name.slice(at + sep.length).trim();
  return model || null;
}

export function retryAssistantAgentId(
  failedAssistant: { agentId?: string | null } | null | undefined,
  configAgentId: string | null | undefined,
): string | undefined {
  const fromFailed = String(failedAssistant?.agentId || '').trim();
  if (fromFailed) return fromFailed;
  const fromConfig = String(configAgentId || '').trim();
  return fromConfig || undefined;
}

export function retryAssistantModel(
  failedAssistant: { agentName?: string | null } | null | undefined,
  fallbackModel: string | null | undefined,
): string | null {
  const fromName = modelIdFromAgentDisplayName(failedAssistant?.agentName);
  if (fromName) return fromName;
  const fallback = String(fallbackModel || '').trim();
  return fallback || null;
}
