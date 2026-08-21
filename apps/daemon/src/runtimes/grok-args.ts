function grokModelSupportsReasoningEffort(model: string | null | undefined): boolean {
  if (!model || model === 'default' || model === 'grok-build') return false;
  return /reasoning/i.test(model);
}

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
  if (input.reasoning && grokModelSupportsReasoningEffort(input.model)) {
    args.push('--effort', input.reasoning);
  }
  const resumeSessionId = String(input.resumeSessionId || '').trim();
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  return args;
}
