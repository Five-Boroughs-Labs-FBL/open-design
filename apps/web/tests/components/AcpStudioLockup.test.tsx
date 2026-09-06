// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AcpStudioLockup } from '../../src/components/AcpStudioLockup';

afterEach(() => {
  cleanup();
});

describe('AcpStudioLockup', () => {
  it('keeps the top chrome mark as ACP Design with the radar logo', () => {
    const { container } = render(<AcpStudioLockup size={18} compact />);
    expect(screen.getByTestId('acp-open-design-brand').textContent).toBe('ACP Design');
    expect(container.querySelector('.acp-radar-mark.is-spinning')).not.toBeNull();
    expect(container.querySelector('.acp-studio-lockup--chrome')).not.toBeNull();
  });

  it('keeps the rail wordmark as AGENT CONTROL PANEL without a logo', () => {
    const { container } = render(<AcpStudioLockup variant="rail" />);
    expect(screen.getByTestId('acp-open-design-brand').textContent).toBe('AGENT CONTROL PANEL');
    expect(container.querySelector('.acp-radar-mark')).toBeNull();
    expect(container.querySelector('.acp-studio-lockup--rail')).not.toBeNull();
  });
});
