// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DesignSurfaceCanvas,
  designSurfaceCanvasFitZoom,
  designSurfaceCanvasLayout,
  type DesignSurfaceCanvasItem,
} from '../../src/components/DesignSurfaceCanvas';
import {
  buildStaticHtmlThumbnailDocument,
  HtmlPageThumbnail,
} from '../../src/components/HtmlPageThumbnail';
import { resetHtmlThumbnailSourceCache } from '../../src/components/html-thumbnail-source-cache';
import type { ProjectFile } from '../../src/types';

function htmlFile(name: string): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 1024,
    mtime: 1_700_000_000_000,
    kind: 'html',
    mime: 'text/html',
  };
}

const surfaces: DesignSurfaceCanvasItem[] = [
  { id: 'journey.home', title: 'Home', status: 'ready', file: htmlFile('home.html') },
  { id: 'journey.search', title: 'Search', status: 'generating' },
  { id: 'journey.checkout', title: 'Checkout', status: 'queued' },
  { id: 'journey.error', title: 'Failure', status: 'failed' },
  { id: 'journey.waived', title: 'Waived', status: 'waived' },
  { id: 'journey.missing', title: 'Missing', status: 'ready' },
];

beforeEach(() => {
  resetHtmlThumbnailSourceCache();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    '<!doctype html><html><body><main style="animation: pulse 10s infinite">Home</main></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html' } },
  )));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DesignSurfaceCanvas', () => {
  it('keeps manifest order and renders explicit progressive states', () => {
    const { container } = render(
      <DesignSurfaceCanvas
        projectId="project-1"
        surfaces={surfaces}
        onOpenSurface={vi.fn()}
      />,
    );

    expect(
      [...container.querySelectorAll<HTMLElement>('[data-surface-id]')]
        .map((node) => node.dataset.surfaceId),
    ).toEqual(surfaces.map((surface) => surface.id));
    expect(screen.getAllByText('Generating').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Waived').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Missing file').length).toBeGreaterThan(0);
  });

  it('switches between the canvas and stable-order grid without changing inputs', () => {
    const onViewChange = vi.fn();
    const { container } = render(
      <DesignSurfaceCanvas
        projectId="project-1"
        surfaces={surfaces}
        onOpenSurface={vi.fn()}
        onViewChange={onViewChange}
      />,
    );

    expect(screen.getByTestId('design-surface-canvas-viewport')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByTestId('design-surface-grid')).toBeTruthy();
    expect(onViewChange).toHaveBeenLastCalledWith('grid');
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-surface-id]')]
        .map((node) => node.dataset.surfaceId),
    ).toEqual(surfaces.map((surface) => surface.id));
  });

  it('selects once, opens on double click or Enter, and arrow-navigates in order', () => {
    const onOpenSurface = vi.fn();
    const onSelectSurface = vi.fn();
    render(
      <DesignSurfaceCanvas
        projectId="project-1"
        surfaces={surfaces}
        onOpenSurface={onOpenSurface}
        onSelectSurface={onSelectSurface}
      />,
    );
    const search = screen.getByRole('button', { name: 'Open Search' });

    fireEvent.click(search);
    expect(onSelectSurface).toHaveBeenLastCalledWith('journey.search');
    expect(onOpenSurface).not.toHaveBeenCalled();

    fireEvent.doubleClick(search);
    expect(onOpenSurface).toHaveBeenLastCalledWith(surfaces[1]);

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onOpenSurface).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(search, { key: 'ArrowRight' });
    expect(onSelectSurface).toHaveBeenLastCalledWith('journey.checkout');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open Checkout' }),
    );
  });

  it('renders ready HTML as a frozen, inert, no-download miniature', async () => {
    const { container } = render(
      <DesignSurfaceCanvas
        projectId="project-1"
        surfaces={surfaces.slice(0, 1)}
        onOpenSurface={vi.fn()}
      />,
    );

    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('tabindex')).toBe('-1');
    expect(iframe.getAttribute('aria-hidden')).toBe('true');
    expect(iframe.getAttribute('srcdoc')).toContain('data-od-motion-freeze');
    expect(iframe.getAttribute('srcdoc')).not.toContain('allow-downloads');
  });

  it('turns authored HTML into a static, offline canvas thumbnail document', () => {
    const document = buildStaticHtmlThumbnailDocument(
      `<!doctype html><html><head>
        <meta http-equiv="refresh" content="0;url=https://attacker.example">
        <script>window.__thumbnailExecuted = true</script>
      </head><body onload="fetch('https://attacker.example')">
        <iframe src="https://attacker.example"></iframe>
        <button onclick="location.reload()">Reload</button>
      </body></html>`,
      'https://open-design.test/project/raw/',
    );

    expect(document).toContain('Content-Security-Policy');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("script-src 'none'");
    expect(document).not.toMatch(/<script\b/i);
    expect(document).not.toMatch(/http-equiv=["']refresh/i);
    expect(document).not.toMatch(/<iframe\b/i);
    expect(document).not.toMatch(/\sonload=|\sonclick=/i);
    expect(document).not.toContain('attacker.example');
  });

  it('places the offline policy before authored fake head tags', () => {
    const document = buildStaticHtmlThumbnailDocument(
      '<!doctype html><!-- <head> --><html><head><title>Fake head regression</title></head>'
        + '<body><img src="https://attacker.example/tracker.png"></body></html>',
      'https://open-design.test/project/raw/',
    );

    expect(document).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy"/i);
    expect(document).toContain("img-src data: blob:");
    expect(document).not.toContain('<base ');
  });

  it('preserves the historical Grid thumbnail defaults outside the canvas', async () => {
    const { container } = render(
      <HtmlPageThumbnail
        projectId="project-grid-default"
        file={htmlFile('grid-default.html')}
        fallback={<span>Loading</span>}
      />,
    );

    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-downloads');
    expect(iframe.getAttribute('tabindex')).toBeNull();
    expect(iframe.getAttribute('srcdoc')).not.toContain('data-od-motion-freeze');
  });

  it('shares the six-request thumbnail budget across every canvas frame', async () => {
    const releases: Array<() => void> = [];
    const pendingFetch = vi.fn(() => new Promise<Response>((resolve) => {
      releases.push(() => resolve(new Response('<!doctype html><p>ready</p>', { status: 200 })));
    }));
    vi.stubGlobal('fetch', pendingFetch);
    const manySurfaces = Array.from({ length: 10 }, (_, index): DesignSurfaceCanvasItem => ({
      id: `surface-${index}`,
      title: `Surface ${index}`,
      status: 'ready',
      file: htmlFile(`pool-${index}.html`),
    }));
    render(
      <DesignSurfaceCanvas
        projectId="project-pool"
        surfaces={manySurfaces}
        onOpenSurface={vi.fn()}
      />,
    );

    await waitFor(() => expect(pendingFetch).toHaveBeenCalledTimes(6));
    await act(async () => {
      for (const release of releases.splice(0)) release();
    });
    await waitFor(() => expect(pendingFetch).toHaveBeenCalledTimes(10));
    await act(async () => {
      for (const release of releases.splice(0)) release();
    });
  });

  it('uses deterministic left-to-right layout for the provided count', () => {
    expect(designSurfaceCanvasLayout(4).positions).toEqual([
      { left: 120, top: 120 },
      { left: 688, top: 120 },
      { left: 120, top: 534 },
      { left: 688, top: 534 },
    ]);
  });

  it('fits the full maximum-size product below the manual zoom floor', () => {
    const layout = designSurfaceCanvasLayout(60);
    const zoom = designSurfaceCanvasFitZoom(layout, 1200, 800);

    expect(zoom).toBeLessThan(0.2);
    expect(layout.width * zoom).toBeLessThanOrEqual(1200 - 32);
    expect(layout.height * zoom).toBeLessThanOrEqual(800 - 32);
  });

  it('can keep zooming out after Fit goes below the ordinary manual floor', () => {
    const manySurfaces = Array.from({ length: 60 }, (_, index): DesignSurfaceCanvasItem => ({
      id: `surface-${index}`,
      title: `Surface ${index}`,
      status: 'queued',
    }));
    render(
      <DesignSurfaceCanvas
        projectId="project-fit-controls"
        surfaces={manySurfaces}
        onOpenSurface={vi.fn()}
      />,
    );
    const viewport = screen.getByTestId('design-surface-canvas-viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 1200 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 800 });

    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    expect(screen.getByText(/%$/).textContent).not.toBe('20%');
    expect(zoomOut).not.toBeDisabled();

    fireEvent.click(zoomOut);
    expect(screen.getByText('1%')).toBeTruthy();
    expect(zoomOut).toBeDisabled();
  });
});
