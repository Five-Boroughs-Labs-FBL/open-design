// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AcpRadarMark } from '../../src/components/AcpRadarMark';

/** Nested-A paths from Agent Control Panel `acpMarkGeometry.ts`. */
const ACP_MARK_OUTER =
  'M 15.91 3.5 L 30 28.51 L 2 28.51 Z M 15.44 11.9 L 23.84 26.27 L 27.76 28.51 L 4.24 28.51 Z';
const ACP_MARK_INNER = 'M 15.81 16.38 L 16.75 18.06 L 11.15 26.27 L 4.99 28.33 Z';

afterEach(() => {
  cleanup();
});

describe('AcpRadarMark', () => {
  it('renders the ACP peak, not the retired radar rings', () => {
    const { container } = render(<AcpRadarMark spinning={false} />);
    const svg = screen.getByRole('img', { name: 'ACP' });
    expect(svg.classList.contains('acp-mark')).toBe(true);
    expect(svg.classList.contains('is-spinning')).toBe(false);
    expect(svg.classList.contains('acp-radar-mark')).toBe(false);
    expect(container.querySelectorAll('circle')).toHaveLength(0);

    const paths = [...svg.querySelectorAll('path')];
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')).toBe(ACP_MARK_OUTER);
    expect(paths[1]?.getAttribute('d')).toBe(ACP_MARK_INNER);
  });

  it('pulses the cyan glow when spinning', () => {
    const { container } = render(<AcpRadarMark spinning />);
    expect(container.querySelector('svg')?.classList.contains('is-spinning')).toBe(true);
  });

  it('uses the requested size on the SVG', () => {
    const { container } = render(<AcpRadarMark size={56} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('56');
    expect(svg?.getAttribute('height')).toBe('56');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 32 32');
  });
});
