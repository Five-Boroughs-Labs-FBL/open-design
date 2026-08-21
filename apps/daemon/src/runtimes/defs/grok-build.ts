import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeModelOption } from '../types.js';
import type { RuntimeAgentDef } from '../types.js';
import { buildGrokHeadlessArgs } from '../grok-args.js';

const GROK_MODEL_ID_RE = /^\*?\s*-?\s*(grok-[a-z0-9][a-z0-9._-]*)(?:\s+\(default\))?\s*$/i;

export function parseGrokBuildModels(stdout: string): RuntimeModelOption[] {
  const seen = new Set<string>();
  const out: RuntimeModelOption[] = [DEFAULT_MODEL_OPTION];
  for (const rawLine of String(stdout || '').split('\n')) {
    const match = rawLine.trim().match(GROK_MODEL_ID_RE);
    const id = match?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  return out;
}

// xAI's first-party CLI agent — https://x.ai/cli — distributed as the
// `grok` binary. Installed via `curl -fsSL https://x.ai/cli/install.sh | bash`,
// which symlinks `~/.grok/bin/grok` into PATH.
//
// `grok` ships its own SuperGrok OAuth dance (same `auth.x.ai` issuer +
// loopback-redirect shape OpenDesign's xAI Settings panel uses), so it's
// already authenticated by the time OD detects the binary; OD does not
// need to inject credentials. Users authenticate once with `grok login
// --oauth` and the resulting `~/.grok/auth.json` is what every spawned
// invocation reads.
//
// Headless mode uses `--prompt-file <PATH>` because recent Grok CLI builds
// require `-p/--single` to receive the prompt as an argv value and no longer
// read piped stdin. OD's composed prompts often exceed safe argv limits, so
// the daemon stages the prompt in a temp file and passes that path here.
//
// `--output-format streaming-json` is the grok CLI's ACP-style NDJSON
// (`{type:"text"|"thought",data}` plus `end`/`usage`). The daemon maps that
// into the same `text_delta` / `thinking_delta` events Claude uses so the
// web artifact parser can paint HTML as it arrives, instead of waiting for
// process exit (`plain` persist-on-success).
export const grokBuildAgentDef = {
  id: 'grok-build',
  name: 'Grok Build',
  bin: 'grok',
  versionArgs: ['--version'],
  helpArgs: ['-p', '--help'],
  // `grok models` prints status/header lines plus bullet-prefixed model ids.
  // Keep only concrete `grok-*` ids so UI pickers don't show prose such as
  // "You are logged in with grok.com" as selectable model names.
  listModels: {
    args: ['models'],
    timeoutMs: 10_000,
    parse: parseGrokBuildModels,
  },
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'grok-build', label: 'grok-build (xAI · default)' },
    { id: 'grok-4.3', label: 'grok-4.3 (xAI)' },
    { id: 'grok-4.20-reasoning', label: 'grok-4.20-reasoning (xAI · deep)' },
    {
      id: 'grok-4.20-non-reasoning',
      label: 'grok-4.20-non-reasoning (xAI · fast)',
    },
    {
      id: 'grok-4.20-multi-agent',
      label: 'grok-4.20-multi-agent (xAI · orchestration)',
    },
  ],
  // Grok Build CLI v0.1.212+ enforces `-p, --single <PROMPT>` as value-
  // required, while normal OD composed prompts exceed safe argv budgets.
  // Use the CLI's explicit prompt-file transport instead. Headless runs also
  // need plan mode disabled and tool calls auto-approved: otherwise a write
  // request is permission-cancelled while the CLI still exits successfully.
  buildArgs: (_prompt, _imagePaths, _extra = [], options = {}, runtimeContext = {}) => {
    return buildGrokHeadlessArgs({
      promptFilePath: runtimeContext.promptFilePath || '',
      resumeSessionId: runtimeContext.resumeSessionId ?? null,
      model: options.model ?? null,
      reasoning: options.reasoning ?? null,
    });
  },
  reasoningOptions: [
    { id: 'low', label: 'low' },
    { id: 'medium', label: 'medium' },
    { id: 'high', label: 'high' },
    { id: 'xhigh', label: 'xhigh' },
    { id: 'max', label: 'max' },
  ],
  promptViaFile: true,
  promptViaStdin: false,
  resumesSessionViaCli: true,
  streamFormat: 'json-event-stream',
  eventParser: 'grok',
  // JSON streaming is a transport. Keep the Claude Design handoff: one
  // `<artifact type="text/html">` block, not "write files, do not emit artifacts".
  executionProfile: 'text_artifact',
  installUrl: 'https://x.ai/cli',
  docsUrl: 'https://x.ai/cli',
} satisfies RuntimeAgentDef;
