// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

const file: ProjectFile = {
  name: 'checkout.html',
  path: 'checkout.html',
  type: 'file',
  size: 1024,
  mtime: 1_700_000_000_000,
  kind: 'html',
  mime: 'text/html',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FileViewer manifest canvas return action', () => {
  it('is absent for ordinary files and calls the narrow return callback when provided', () => {
    const onShowAllScreens = vi.fn();
    const { rerender } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<!doctype html><html><body>Checkout</body></html>"
      />,
    );

    expect(screen.queryByTestId('file-viewer-all-screens')).toBeNull();

    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<!doctype html><html><body>Checkout</body></html>"
        onShowAllScreens={onShowAllScreens}
      />,
    );
    const button = screen.getByTestId('file-viewer-all-screens');
    expect(button.getAttribute('aria-label')).toBe('All screens');
    fireEvent.click(button);
    expect(onShowAllScreens).toHaveBeenCalledTimes(1);
  });

  it('returns a generated image to All screens when a design manifest exists', () => {
    const onShowAllScreens = vi.fn();
    const image: ProjectFile = {
      name: 'gallery-01.png',
      path: 'gallery-01.png',
      type: 'file',
      size: 2048,
      mtime: 1_700_000_000_000,
      kind: 'image',
      mime: 'image/png',
    };

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={image}
        onShowAllScreens={onShowAllScreens}
      />,
    );

    const button = screen.getByTestId('file-viewer-all-screens');
    expect(button.getAttribute('aria-label')).toBe('All screens');
    fireEvent.click(button);
    expect(onShowAllScreens).toHaveBeenCalledTimes(1);
  });
});
