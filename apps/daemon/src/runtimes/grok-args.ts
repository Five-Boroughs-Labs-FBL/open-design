export function buildGrokHeadlessArgs(input: {
  promptFilePath: string;
  resumeSessionId?: string | null;
  model?: string | null;
  reasoning?: string | null;
}): string[] {
  const promptFilePath = String(input.promptFilePath || '');
  if (!promptFilePath) {
    throw new Error('grok-build requires runtimeContext.promptFilePath');
  }
  const args = [
    '--prompt-file',
    promptFilePath,
    '--output-format',
    'streaming-json',
    '--no-plan',
    '--always-approve',
  ];
  if (input.model && input.model !== 'default') {
    args.push('--model', input.model);
  }
  // Same flag AMC's grok planner uses. CLI alias is --effort. Do not gate on
  // the model id containing "reasoning": grok-4.6 / grok-4.3 take this too.
  const reasoning = String(input.reasoning || '').trim();
  if (reasoning) {
    args.push('--reasoning-effort', reasoning);
  }
  const resumeSessionId = String(input.resumeSessionId || '').trim();
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  return args;
}
