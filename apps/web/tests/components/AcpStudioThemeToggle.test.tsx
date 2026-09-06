// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ACP_STUDIO_THEME_KEY,
  applyAcpStudioAppearance,
} from '../../src/acp-brand';
import { AcpStudioThemeToggle } from '../../src/components/AcpStudioThemeToggle';
import { I18nProvider } from '../../src/i18n';

afterEach(() => {
  cleanup();
  localStorage.removeItem(ACP_STUDIO_THEME_KEY);
  sessionStorage.removeItem('od-acp-studio-preview');
  document.documentElement.removeAttribute('data-acp-studio');
  document.documentElement.setAttribute('data-theme', 'light');
});

describe('AcpStudioThemeToggle', () => {
  it('switches the document between ACP dark and light', () => {
    sessionStorage.setItem('od-acp-studio-preview', '1');
    applyAcpStudioAppearance(window);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    render(
      <I18nProvider initial="en">
        <AcpStudioThemeToggle />
      </I18nProvider>,
    );

    const toggle = screen.getByTestId('acp-studio-theme-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(ACP_STUDIO_THEME_KEY)).toBe('light');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
