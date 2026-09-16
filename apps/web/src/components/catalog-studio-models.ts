import { KNOWN_PROVIDERS } from '../state/config';
import type { AppConfig } from '../types';

export const CATALOG_STUDIO_GROK_AGENT = 'grok-build';
export const CATALOG_STUDIO_GROK_MODEL = 'grok-4.6';
export const CATALOG_STUDIO_MINIMAX_ID = 'minimax';

export type CatalogStudioModelId = typeof CATALOG_STUDIO_GROK_MODEL | typeof CATALOG_STUDIO_MINIMAX_ID;

export type CatalogStudioModelOption = {
  id: CatalogStudioModelId;
  label: string;
};

/** The only models a catalog regular may pick. Grok 4.6 is the default. */
export const CATALOG_STUDIO_MODEL_OPTIONS: readonly CatalogStudioModelOption[] = [
  { id: CATALOG_STUDIO_GROK_MODEL, label: 'grok-4.6' },
  { id: CATALOG_STUDIO_MINIMAX_ID, label: 'MiniMax' },
];

function isMinimaxBaseUrl(url: string | null | undefined): boolean {
  return String(url || '').toLowerCase().includes('minimax');
}

function minimaxProvider(config: AppConfig) {
  const current = String(config.baseUrl || '').toLowerCase();
  const byUrl = KNOWN_PROVIDERS.find((provider) => {
    if (!provider.label.startsWith('MiniMax')) return false;
    return current.includes('minimax.io')
      ? provider.baseUrl.includes('minimax.io')
      : provider.baseUrl.includes('minimaxi.com');
  });
  return (
    byUrl
    ?? KNOWN_PROVIDERS.find((provider) => provider.label === 'MiniMax — Anthropic')
    ?? KNOWN_PROVIDERS.find((provider) => provider.label.startsWith('MiniMax'))
    ?? null
  );
}

export function catalogStudioModelId(config: AppConfig): CatalogStudioModelId {
  if (config.mode === 'api' && isMinimaxBaseUrl(config.baseUrl)) {
    return CATALOG_STUDIO_MINIMAX_ID;
  }
  return CATALOG_STUDIO_GROK_MODEL;
}

export function needsCatalogStudioGrokLatch(config: AppConfig): boolean {
  if (catalogStudioModelId(config) === CATALOG_STUDIO_MINIMAX_ID) return false;
  return !(
    config.mode === 'daemon'
    && config.agentId === CATALOG_STUDIO_GROK_AGENT
    && config.agentModels?.[CATALOG_STUDIO_GROK_AGENT]?.model === CATALOG_STUDIO_GROK_MODEL
  );
}

/**
 * Catalog SSO regulars are limited to grok-4.6 / MiniMax. I'll-design-it
 * uses a project embed grant, not a catalog session. An unresolved embed
 * hint looks like a catalog regular (hide Settings while hydrating) and
 * must not rewrite Cursor Design onto grok-build — Cursor may be running
 * the vendor model id grok-4.6.
 */
export function shouldApplyCatalogStudioGrokLatch(input: {
  runtimeResolved: boolean;
  catalogRegular: boolean;
  config: AppConfig;
}): boolean {
  if (!input.runtimeResolved) return false;
  if (!input.catalogRegular) return false;
  return needsCatalogStudioGrokLatch(input.config);
}

/**
 * Apply a catalog-regular pick.
 *
 * Grok 4.6 stays on the host grok-build CLI (admin SuperGrok). MiniMax is
 * Anthropic-compatible HTTP; the daemon fills the admin ACP MiniMax key and
 * talks to MiniMax directly when OpenCode is not installed. The regular
 * picker only flips mode/baseUrl/model. Paid XAI_API_KEY is unused.
 */
export function applyCatalogStudioModel(
  config: AppConfig,
  pick: CatalogStudioModelId,
): AppConfig {
  if (pick === CATALOG_STUDIO_MINIMAX_ID) {
    const provider = minimaxProvider(config);
    return {
      ...config,
      mode: 'api',
      apiProtocol: provider?.protocol ?? 'anthropic',
      // Daemon fills the admin MiniMax vault key. A leftover Anthropic /
      // OpenAI Settings key must not travel on the BYOK snapshot.
      apiKey: '',
      baseUrl: provider?.baseUrl ?? 'https://api.minimax.io/anthropic',
      apiProviderBaseUrl: provider?.baseUrl ?? 'https://api.minimax.io/anthropic',
      model: provider?.preferredModels[0] ?? 'MiniMax-M2.7-highspeed',
    };
  }
  return {
    ...config,
    mode: 'daemon',
    agentId: CATALOG_STUDIO_GROK_AGENT,
    agentModels: {
      ...config.agentModels,
      [CATALOG_STUDIO_GROK_AGENT]: {
        ...(config.agentModels?.[CATALOG_STUDIO_GROK_AGENT] ?? {}),
        model: CATALOG_STUDIO_GROK_MODEL,
      },
    },
  };
}
