export type ExecutionProfile = 'filesystem' | 'text_artifact';

export function executionProfileFromStreamFormat(
  streamFormat: string | null | undefined,
): ExecutionProfile {
  return streamFormat === 'plain' ? 'text_artifact' : 'filesystem';
}

/** Adapter-level override wins so JSON streaming can still emit `<artifact>` HTML. */
export function resolveExecutionProfile(
  streamFormat: string | null | undefined,
  override?: ExecutionProfile | null,
): ExecutionProfile {
  return override ?? executionProfileFromStreamFormat(streamFormat);
}
