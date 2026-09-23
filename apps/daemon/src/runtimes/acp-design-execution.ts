import { resolveCatalogAcpBeBaseUrl } from './catalog-grok-auth.js';
import { parseAmcCredentialBlock, type AmcCredential } from './amc-credential.js';

export interface CurrentAcpDesignExecution {
  agentId: 'grok-build' | 'cursor-agent' | 'muse' | 'codex' | 'byok-opencode';
  model: string;
  reasoning: string | null;
  amcGrok?: { authJson: string };
  amcCredential?: AmcCredential;
  byokProvider?: { protocol: 'anthropic'; apiKey: string; baseUrl: string; model: string };
}

/** Resolve one new ACP Design turn. The server token and credentials never reach the browser. */
export async function fetchCurrentAcpDesignExecution(
  featureRunId: string,
  projectId: string,
  userId: string,
  includeCredentials: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CurrentAcpDesignExecution> {
  const base = resolveCatalogAcpBeBaseUrl(env);
  const token = String(env.OD_API_TOKEN || '').trim();
  if (!base || !token || !featureRunId || !projectId || !userId) {
    throw new Error('ACP Design connection is not configured');
  }
  const url = new URL('/api/open-design/design-execution', `${base}/`);
  url.searchParams.set('featureRunId', featureRunId);
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('userId', userId);
  if (includeCredentials) url.searchParams.set('credentials', '1');
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-store' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`ACP Design selection is unavailable (${response.status})`);
  const value = await response.json() as Record<string, unknown>;
  const agentId = value?.agentId;
  const model = value?.model;
  if (agentId !== 'grok-build' && agentId !== 'cursor-agent'
    && agentId !== 'muse' && agentId !== 'codex' && agentId !== 'byok-opencode') {
    throw new Error('ACP Design returned an unsupported provider');
  }
  if (typeof model !== 'string' || !model.trim()
    || (value.reasoning != null && typeof value.reasoning !== 'string')) {
    throw new Error('ACP Design returned an invalid model selection');
  }
  const execution: CurrentAcpDesignExecution = {
    agentId,
    model: model.trim(),
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : null,
  };
  if (!includeCredentials) return execution;
  if (agentId === 'grok-build') {
    const grok = value.amcGrok as Record<string, unknown> | undefined;
    if (typeof grok?.authJson !== 'string' || !grok.authJson.trim()) {
      throw new Error('ACP Design Grok credential is unavailable');
    }
    execution.amcGrok = { authJson: grok.authJson };
  } else if (agentId === 'byok-opencode') {
    const provider = value.byokProvider as Record<string, unknown> | undefined;
    if (provider?.protocol !== 'anthropic' || typeof provider.apiKey !== 'string'
      || !provider.apiKey.trim() || typeof provider.model !== 'string'
      || !provider.model.trim() || typeof provider.baseUrl !== 'string') {
      throw new Error('ACP Design MiniMax credential is unavailable');
    }
    execution.byokProvider = {
      protocol: 'anthropic', apiKey: provider.apiKey,
      baseUrl: provider.baseUrl, model: provider.model,
    };
  } else {
    const credential = parseAmcCredentialBlock(value.amcCredential);
    const expectedFamily = agentId === 'muse' ? 'muse' : agentId === 'codex' ? 'codex' : 'cursor';
    if (!credential || credential.family !== expectedFamily) {
      throw new Error('ACP Design provider credential does not match its model');
    }
    execution.amcCredential = credential;
  }
  return execution;
}
