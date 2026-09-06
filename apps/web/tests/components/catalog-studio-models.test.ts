import { describe, expect, it } from 'vitest';

import {
  applyCatalogStudioModel,
  catalogStudioModelId,
  CATALOG_STUDIO_GROK_MODEL,
  CATALOG_STUDIO_MINIMAX_ID,
  needsCatalogStudioGrokLatch,
} from '../../src/components/catalog-studio-models';
import { isCatalogRegularStudioUser } from '../../src/components/entry-rail-account-state';
import type { AppConfig } from '../../src/types';

const base: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: '',
  agentId: 'grok-build',
  skillId: null,
  designSystemId: null,
};

describe('catalog studio models', () => {
  it('treats only signed-out-capable non-admin chrome as a catalog regular', () => {
    expect(isCatalogRegularStudioUser({
      showHostAdminChrome: false,
      showAcpSignOut: true,
    })).toBe(true);
    expect(isCatalogRegularStudioUser({
      showHostAdminChrome: true,
      showAcpSignOut: true,
    })).toBe(false);
    expect(isCatalogRegularStudioUser({
      showHostAdminChrome: true,
      showAcpSignOut: false,
    })).toBe(false);
  });

  it('latches Default CLI config onto grok-4.6', () => {
    expect(needsCatalogStudioGrokLatch(base)).toBe(true);
    expect(catalogStudioModelId(base)).toBe(CATALOG_STUDIO_GROK_MODEL);
    const next = applyCatalogStudioModel(base, CATALOG_STUDIO_GROK_MODEL);
    expect(next.mode).toBe('daemon');
    expect(next.agentId).toBe('grok-build');
    expect(next.agentModels?.['grok-build']?.model).toBe('grok-4.6');
    expect(needsCatalogStudioGrokLatch(next)).toBe(false);
  });

  it('wires MiniMax as Anthropic-compatible HTTP, not a grok-build model id', () => {
    const next = applyCatalogStudioModel(base, CATALOG_STUDIO_MINIMAX_ID);
    expect(next.mode).toBe('api');
    expect(next.baseUrl).toMatch(/minimax/i);
    expect(next.model).toMatch(/MiniMax/i);
    expect(catalogStudioModelId(next)).toBe(CATALOG_STUDIO_MINIMAX_ID);
    expect(needsCatalogStudioGrokLatch(next)).toBe(false);
  });

  it('drops a leftover Settings API key when switching to MiniMax', () => {
    const next = applyCatalogStudioModel(
      { ...base, apiKey: 'sk-ant-leftover' },
      CATALOG_STUDIO_MINIMAX_ID,
    );
    expect(next.apiKey).toBe('');
    expect(next.baseUrl).toMatch(/minimax/i);
  });
});
