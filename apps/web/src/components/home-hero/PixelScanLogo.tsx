import { useEffect, useRef } from 'react';

import { ACP_STUDIO_THEME_EVENT } from '../../acp-brand';
import {
  drawStaticLogo,
  PixelScanField,
  readHeroWordmarkInk,
} from './pixel-scan/engine';

interface Props {
  className?: string;
  /** Accessible label for the wordmark (the canvas itself is decorative). */
  label?: string;
}

// Mounts the pixel-scan shader wordmark onto a sized, position:relative host.
// `three` is lazy-imported so the WebGL runtime stays out of the main bundle;
// reduced motion (or a failed import / missing WebGL) falls back to the same
// word drawn statically. A ResizeObserver keeps the canvas in sync as the hero
// column reflows. The engine listens on the HOST (the canvas itself is
// pointer-events:none via .home-hero__logo--tiles > canvas).
export function PixelScanLogo({ className, label = 'ACP Design' }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const redraw = () => drawStaticLogo(canvas, host, readHeroWordmarkInk());
      redraw();
      return watchHeroTheme(redraw);
    }

    let disposed = false;
    let field: PixelScanField | null = null;
    let ro: ResizeObserver | null = null;
    let frame = 0;

    const applyInk = () => {
      field?.setInk(readHeroWordmarkInk());
    };

    void import('three')
      .then((THREE) => {
        if (disposed) return;
        field = new PixelScanField(host, canvas, THREE, { ink: readHeroWordmarkInk() });
        field.start();
        ro = new ResizeObserver(() => {
          // Coalesce bursts of resize notifications into one re-measure per frame.
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            frame = 0;
            field?.resize();
          });
        });
        ro.observe(host);
      })
      .catch((err: unknown) => {
        // Surface the underlying failure — the static fallback must not mask it.
        console.error('[pixel-scan] falling back to static logo:', err);
        if (!disposed) drawStaticLogo(canvas, host, readHeroWordmarkInk());
      });

    const stopWatchingTheme = watchHeroTheme(applyInk);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      stopWatchingTheme();
      ro?.disconnect();
      field?.destroy();
    };
  }, []);

  return (
    <div ref={hostRef} className={className} role="img" aria-label={label}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function watchHeroTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  window.addEventListener(ACP_STUDIO_THEME_EVENT, onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener(ACP_STUDIO_THEME_EVENT, onChange);
  };
}
