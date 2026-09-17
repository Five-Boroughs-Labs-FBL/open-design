import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

const SAFE_MODEL_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_SESSION_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function buildMuseHeadlessArgs(input: {
  promptFilePath: string;
  resumeSessionId?: string | null;
  model?: string | null;
  reasoning?: string | null;
}): string[] {
  const promptFilePath = String(input.promptFilePath || '');
  if (!promptFilePath) {
    throw new Error('muse requires runtimeContext.promptFilePath');
  }
  const args = [
    'exec',
    '--json',
    '--approval-mode',
    'never',
    '--trust-workspace',
    '--disable-sandbox',
    '--prompt-file',
    promptFilePath,
  ];
  const rawModel = String(input.model || '').trim();
  const model =
    !rawModel || rawModel === 'default' || rawModel === 'muse-spark-1.3-contributor'
      ? 'muse-spark-1.3'
      : rawModel;
  if (SAFE_MODEL_RE.test(model)) {
    args.push('--model', model);
  }
  const reasoning = String(input.reasoning || '').trim().toLowerCase();
  if (reasoning) {
    args.push('--reasoning-effort', reasoning);
  }
  const resumeSessionId = String(input.resumeSessionId || '').trim();
  if (resumeSessionId && SAFE_SESSION_RE.test(resumeSessionId)) {
    args.push('--session-id', resumeSessionId);
  }
  return args;
}

/**
 * Meta Muse Code — https://dev.meta.ai/docs/muse-code
 *
 * AMC Settings Design = Muse sends `agentId: "muse"` plus
 * `amcCredential.family=muse` / `META_API_KEY`. This adapter must exist or
 * OD falls through to the host default (often grok-build).
 *
 * Headless: `muse exec --json --approval-mode never --trust-workspace
 * --disable-sandbox --prompt-file`. Default model is Spark 1.3.
 * JSONL is `{stream, payload_type, payload}`, not Grok `{type,sessionId}`.
 */
export const museAgentDef = {
  id: 'muse',
  name: 'Muse Code',
  bin: 'muse',
  versionArgs: ['--version'],
  helpArgs: ['--help'],
  env: {
    MUSE_NO_AUTO_UPDATE: '1',
  },
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'muse-spark-1.3', label: 'muse-spark-1.3 (default)' },
    { id: 'muse-spark-1.3-contributor', label: 'muse-spark-1.3-contributor → 1.3' },
    { id: 'muse-spark-1.2', label: 'muse-spark-1.2' },
    { id: 'muse-spark-1.1', label: 'muse-spark-1.1' },
  ],
  buildArgs: (
    _prompt,
    _imagePaths,
    _extra = [],
    options = {},
    runtimeContext = {},
  ) => {
    return buildMuseHeadlessArgs({
      promptFilePath: runtimeContext.promptFilePath || '',
      resumeSessionId: runtimeContext.resumeSessionId ?? null,
      model: options.model ?? null,
      reasoning: options.reasoning ?? null,
    });
  },
  reasoningOptions: [
    { id: 'minimal', label: 'minimal' },
    { id: 'low', label: 'low' },
    { id: 'medium', label: 'medium' },
    { id: 'high', label: 'high' },
    { id: 'xhigh', label: 'xhigh' },
    { id: 'max', label: 'max' },
    { id: 'ultra', label: 'ultra' },
  ],
  promptViaFile: true,
  promptViaStdin: false,
  resumesSessionViaCli: true,
  capturesSessionIdFromStream: true,
  streamFormat: 'json-event-stream',
  eventParser: 'muse',
  executionProfile: 'text_artifact',
  installUrl: 'https://dev.meta.ai/docs/muse-code',
  docsUrl: 'https://dev.meta.ai/docs/muse-code',
} satisfies RuntimeAgentDef;
