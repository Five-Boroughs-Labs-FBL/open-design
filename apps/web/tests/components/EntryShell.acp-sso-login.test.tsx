// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig } from '../../src/types';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      newRequestId: vi.fn(() => 'request-1'),
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      track: vi.fn(),
    }),
    useAppVersion: () => null,
  };
});

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;
  sessionStorage.removeItem('od-acp-studio-preview');
  document.documentElement.removeAttribute('data-acp-studio');
});

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public-runtime')) {
      return jsonResponse({
        acpSsoUrl: 'https://acp.test/open-design/sso',
        embedSession: null,
      });
    }
    return jsonResponse({});
  }) as typeof fetch;
});

function renderOnboarding() {
  window.history.replaceState(null, '', '/onboarding');
  return render(
    <I18nProvider initial="en">
      <EntryShell
        skills={[]}
        designTemplates={[]}
        designSystems={[]}
        projects={[]}
        templates={[]}
        promptTemplates={[]}
        defaultDesignSystemId={null}
        connectors={[]}
        connectorsLoading={false}
        config={{
          mode: 'daemon',
          agentId: null,
          agentModels: {},
          apiProtocol: 'anthropic',
          apiProtocolConfigs: {},
          apiKey: '',
          baseUrl: '',
          model: '',
        } as AppConfig}
        agents={[{ id: 'codex', name: 'Codex', bin: 'codex', available: true } as AgentInfo]}
        daemonLive
        onModeChange={vi.fn()}
        onAgentChange={vi.fn()}
        onAgentModelChange={vi.fn()}
        onApiProtocolChange={vi.fn()}
        onApiModelChange={vi.fn()}
        onConfigPersist={vi.fn()}
        onRefreshAgents={vi.fn()}
        onCreateProject={vi.fn()}
        onCreatePluginShareProject={vi.fn()}
        onImportClaudeDesign={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDeleteProject={vi.fn()}
        onRenameProject={vi.fn()}
        onChangeDefaultDesignSystem={vi.fn()}
        onPersistComposioKey={vi.fn()}
        onOpenSettings={vi.fn()}
        onCompleteOnboarding={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe('ACP SSO login pane', () => {
  it('renders the ACP auth card instead of OpenDesign art and local CLI shortcuts', async () => {
    const { container } = renderOnboarding();

    await waitFor(() => {
      expect(container.querySelector('.onboarding-view--acp')).not.toBeNull();
    });
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /ACP Design/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue with ACP/i })).toBeTruthy();
    expect(container.querySelector('.onboarding-cloud__art')).toBeNull();
    expect(container.querySelector('.onboarding-cloud__alts')).toBeNull();
    expect(container.querySelector('.acp-sso-header')).not.toBeNull();
    expect(screen.getByTestId('acp-studio-theme-toggle')).toBeTruthy();
    expect(screen.getByTestId('acp-open-design-brand')).toBeTruthy();
    expect(screen.getByTestId('acp-open-design-brand').textContent).toMatch(/ACP Design/);
    expect(container.querySelector('.acp-radar-mark.is-spinning')).not.toBeNull();
  });

  it('does not offer OpenDesign Cloud sign-in on the ACP studio shell', async () => {
    sessionStorage.setItem('od-acp-studio-preview', '1');
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/public-runtime')) {
        return jsonResponse({ acpSsoUrl: null, embedSession: null });
      }
      return jsonResponse({});
    }) as typeof fetch;

    renderOnboarding();

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /Sign in to OpenDesign/i })).toBeNull();
    const cta = screen.getByRole('button', { name: /Continue with ACP|Loading/i });
    expect(cta).toBeDisabled();
  });
});
