import { Button } from '@open-design/components';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import type { ProjectFile } from '../types';
import { HtmlPageThumbnail } from './HtmlPageThumbnail';
import { Icon, type IconName } from './Icon';
import styles from './DesignSurfaceCanvas.module.css';

export type DesignSurfaceStatus =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'waived'
  | 'missing';
export type DesignSurfaceView = 'canvas' | 'grid';

/** Manifest-order surface data. The web layer does not depend on daemon state. */
export interface DesignSurfaceCanvasItem {
  id: string;
  title: string;
  status: DesignSurfaceStatus;
  file?: ProjectFile;
  description?: string;
}

export interface DesignSurfaceCanvasLabels {
  canvas: string;
  grid: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  resetZoom: string;
  openSurface: (title: string) => string;
  status: Record<DesignSurfaceStatus, string>;
}

const DEFAULT_LABELS: DesignSurfaceCanvasLabels = {
  canvas: 'Canvas',
  grid: 'Grid',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit',
  resetZoom: 'Reset zoom',
  openSurface: (title) => `Open ${title}`,
  status: {
    queued: 'Queued',
    generating: 'Generating',
    ready: 'Ready',
    failed: 'Failed',
    waived: 'Waived',
    missing: 'Missing file',
  },
};

const MIN_ZOOM = 0.2;
const MIN_FIT_ZOOM = 0.01;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.15;
const FRAME_WIDTH = 480;
const FRAME_HEIGHT = 270;
const FRAME_CAPTION_HEIGHT = 48;
const FRAME_GAP_X = 88;
const FRAME_GAP_Y = 96;
const WORLD_PADDING = 120;

interface CanvasPosition {
  left: number;
  top: number;
}

interface CanvasLayout {
  width: number;
  height: number;
  positions: CanvasPosition[];
}

function clampZoom(value: number, minimum = MIN_ZOOM): number {
  return Math.min(MAX_ZOOM, Math.max(minimum, value));
}

/** Stable, deterministic layout: manifest order always reads left-to-right. */
export function designSurfaceCanvasLayout(count: number): CanvasLayout {
  if (count <= 0) {
    return { width: WORLD_PADDING * 2, height: WORLD_PADDING * 2, positions: [] };
  }
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / columns);
  const slotHeight = FRAME_HEIGHT + FRAME_CAPTION_HEIGHT;
  return {
    width: WORLD_PADDING * 2 + columns * FRAME_WIDTH + (columns - 1) * FRAME_GAP_X,
    height: WORLD_PADDING * 2 + rows * slotHeight + (rows - 1) * FRAME_GAP_Y,
    positions: Array.from({ length: count }, (_, index) => ({
      left: WORLD_PADDING + (index % columns) * (FRAME_WIDTH + FRAME_GAP_X),
      top: WORLD_PADDING + Math.floor(index / columns) * (slotHeight + FRAME_GAP_Y),
    })),
  };
}

export function designSurfaceCanvasFitZoom(
  layout: Pick<CanvasLayout, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const availableWidth = Math.max(1, viewportWidth - 32);
  const availableHeight = Math.max(1, viewportHeight - 32);
  return Math.min(MAX_ZOOM, Math.max(MIN_FIT_ZOOM, Math.min(
    availableWidth / layout.width,
    availableHeight / layout.height,
    1,
  )));
}

export interface DesignSurfaceCanvasProps {
  projectId: string;
  /** Ordered exactly as the manifest; this component never sorts it. */
  surfaces: readonly DesignSurfaceCanvasItem[];
  filesRefreshKey?: number;
  labels?: DesignSurfaceCanvasLabels;
  defaultView?: DesignSurfaceView;
  view?: DesignSurfaceView;
  onViewChange?: (view: DesignSurfaceView) => void;
  selectedSurfaceId?: string | null;
  onSelectSurface?: (surfaceId: string) => void;
  onOpenSurface: (surface: DesignSurfaceCanvasItem) => void;
  className?: string;
}

/**
 * Canva-like review surface for a manifest's ordered pages. It is purposely a
 * lightweight overview, not another editor: static inert miniatures live on a
 * pannable/zoomable board and opening a surface hands off to the existing
 * detailed viewer through `onOpenSurface`.
 */
export function DesignSurfaceCanvas({
  projectId,
  surfaces,
  filesRefreshKey = 0,
  labels = DEFAULT_LABELS,
  defaultView = 'canvas',
  view,
  onViewChange,
  selectedSurfaceId,
  onSelectSurface,
  onOpenSurface,
  className,
}: DesignSurfaceCanvasProps) {
  const [uncontrolledView, setUncontrolledView] = useState<DesignSurfaceView>(defaultView);
  const resolvedView = view ?? uncontrolledView;
  const firstSurfaceId = surfaces[0]?.id ?? null;
  const [uncontrolledSelection, setUncontrolledSelection] = useState<string | null>(
    selectedSurfaceId ?? firstSurfaceId,
  );
  const selectionExists = surfaces.some((surface) => surface.id === selectedSurfaceId);
  const uncontrolledSelectionExists = surfaces.some(
    (surface) => surface.id === uncontrolledSelection,
  );
  const resolvedSelection = selectedSurfaceId !== undefined
    ? (selectionExists ? selectedSurfaceId : firstSurfaceId)
    : (uncontrolledSelectionExists ? uncontrolledSelection : firstSurfaceId);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRefs = useRef(new Map<string, HTMLButtonElement>());
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null,
  );
  const spacePressedRef = useRef(false);
  const layout = useMemo(() => designSurfaceCanvasLayout(surfaces.length), [surfaces.length]);

  useEffect(() => {
    if (selectedSurfaceId === undefined && !uncontrolledSelectionExists) {
      setUncontrolledSelection(firstSurfaceId);
    }
  }, [firstSurfaceId, selectedSurfaceId, uncontrolledSelectionExists]);

  const setView = useCallback((next: DesignSurfaceView) => {
    if (view === undefined) setUncontrolledView(next);
    onViewChange?.(next);
  }, [onViewChange, view]);

  const selectSurface = useCallback((surfaceId: string) => {
    if (selectedSurfaceId === undefined) setUncontrolledSelection(surfaceId);
    onSelectSurface?.(surfaceId);
  }, [onSelectSurface, selectedSurfaceId]);

  const updateZoom = useCallback((nextZoom: number) => {
    const viewport = viewportRef.current;
    // Fit may intentionally place a large board below the manual 20% floor.
    // A subsequent wheel-down gesture must not jump that fitted board upward.
    const clamped = clampZoom(
      nextZoom,
      zoom < MIN_ZOOM ? MIN_FIT_ZOOM : MIN_ZOOM,
    );
    if (!viewport || clamped === zoom) {
      setZoom(clamped);
      return;
    }
    const centerX = viewport.clientWidth / 2;
    const centerY = viewport.clientHeight / 2;
    const worldX = (viewport.scrollLeft + centerX) / zoom;
    const worldY = (viewport.scrollTop + centerY) / zoom;
    setZoom(clamped);
    requestAnimationFrame(() => {
      viewport.scrollLeft = worldX * clamped - centerX;
      viewport.scrollTop = worldY * clamped - centerY;
    });
  }, [zoom]);

  const fitCanvas = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextZoom = designSurfaceCanvasFitZoom(
      layout,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (layout.width * nextZoom - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (layout.height * nextZoom - viewport.clientHeight) / 2);
    });
  }, [layout.height, layout.width]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    const viewport = viewportRef.current;
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  }, []);

  const focusSurfaceAtOffset = useCallback((offset: number) => {
    if (surfaces.length === 0) return;
    const currentIndex = Math.max(0, surfaces.findIndex((surface) => surface.id === resolvedSelection));
    const nextIndex = (currentIndex + offset + surfaces.length) % surfaces.length;
    const next = surfaces[nextIndex]!;
    selectSurface(next.id);
    frameRefs.current.get(next.id)?.focus();
  }, [resolvedSelection, selectSurface, surfaces]);

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') spacePressedRef.current = true;
    if ((event.target as HTMLElement).closest(`.${styles.toolbar}`)) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      updateZoom(zoom + ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      updateZoom(zoom - ZOOM_STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      resetZoom();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      fitCanvas();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusSurfaceAtOffset(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusSurfaceAtOffset(-1);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resolvedView !== 'canvas') return;
    const onFrame = (event.target as HTMLElement).closest(`.${styles.frame}`);
    const canPan = event.button === 1 || spacePressedRef.current || !onFrame;
    if (!canPan) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    const viewport = viewportRef.current;
    if (!start || !viewport) return;
    viewport.scrollLeft = start.scrollLeft - (event.clientX - start.x);
    viewport.scrollTop = start.scrollTop - (event.clientY - start.y);
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panStartRef.current = null;
    setPanning(false);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  };

  return (
    <section
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-view={resolvedView}
      onKeyDown={handleKeyboard}
      onKeyUp={(event) => {
        if (event.key === ' ') spacePressedRef.current = false;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) spacePressedRef.current = false;
      }}
    >
      <div className={styles.toolbar}>
        <div className={styles.viewSwitch} role="group" aria-label="Surface view">
          <Button
            variant="subtle"
            className={resolvedView === 'canvas' ? styles.activeControl : undefined}
            aria-pressed={resolvedView === 'canvas'}
            onClick={() => setView('canvas')}
          >
            <Icon name="artboard" size={14} />
            {labels.canvas}
          </Button>
          <Button
            variant="subtle"
            className={resolvedView === 'grid' ? styles.activeControl : undefined}
            aria-pressed={resolvedView === 'grid'}
            onClick={() => setView('grid')}
          >
            <Icon name="grid" size={14} />
            {labels.grid}
          </Button>
        </div>
        {resolvedView === 'canvas' ? (
          <div className={styles.zoomControls} role="group" aria-label="Canvas zoom">
            <Button
              variant="subtle"
              size="icon"
              aria-label={labels.zoomOut}
              disabled={zoom <= MIN_FIT_ZOOM}
              onClick={() => updateZoom(zoom - ZOOM_STEP)}
            >
              <Icon name="zoom-out" size={15} />
            </Button>
            <Button variant="subtle" className={styles.zoomValue} onClick={resetZoom}>
              <span aria-label={labels.resetZoom}>{Math.round(zoom * 100)}%</span>
            </Button>
            <Button
              variant="subtle"
              size="icon"
              aria-label={labels.zoomIn}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => updateZoom(zoom + ZOOM_STEP)}
            >
              <Icon name="zoom-in" size={15} />
            </Button>
            <Button variant="subtle" onClick={fitCanvas}>
              <Icon name="maximize" size={14} />
              {labels.fit}
            </Button>
          </div>
        ) : null}
      </div>

      {resolvedView === 'canvas' ? (
        <div
          ref={viewportRef}
          className={[styles.viewport, panning ? styles.panning : ''].filter(Boolean).join(' ')}
          data-testid="design-surface-canvas-viewport"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPan}
          onPointerCancel={finishPan}
          onWheel={handleWheel}
        >
          <div
            className={styles.scaledPlane}
            style={{ width: layout.width * zoom, height: layout.height * zoom }}
          >
            <div
              className={styles.plane}
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${zoom})`,
              }}
            >
              {surfaces.map((surface, index) => (
                <SurfaceFrame
                  key={surface.id}
                  ref={(node) => {
                    if (node) frameRefs.current.set(surface.id, node);
                    else frameRefs.current.delete(surface.id);
                  }}
                  projectId={projectId}
                  surface={surface}
                  filesRefreshKey={filesRefreshKey}
                  labels={labels}
                  selected={surface.id === resolvedSelection}
                  style={{ left: layout.positions[index]!.left, top: layout.positions[index]!.top }}
                  onSelect={() => selectSurface(surface.id)}
                  onOpen={() => onOpenSurface(surface)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.grid} data-testid="design-surface-grid">
          {surfaces.map((surface) => (
            <SurfaceFrame
              key={surface.id}
              ref={(node) => {
                if (node) frameRefs.current.set(surface.id, node);
                else frameRefs.current.delete(surface.id);
              }}
              projectId={projectId}
              surface={surface}
              filesRefreshKey={filesRefreshKey}
              labels={labels}
              selected={surface.id === resolvedSelection}
              onSelect={() => selectSurface(surface.id)}
              onOpen={() => onOpenSurface(surface)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface SurfaceFrameProps {
  projectId: string;
  surface: DesignSurfaceCanvasItem;
  filesRefreshKey: number;
  labels: DesignSurfaceCanvasLabels;
  selected: boolean;
  style?: CSSProperties;
  onSelect: () => void;
  onOpen: () => void;
}

const SurfaceFrame = forwardRef<HTMLButtonElement, SurfaceFrameProps>(function SurfaceFrame({
  projectId,
  surface,
  filesRefreshKey,
  labels,
  selected,
  style,
  onSelect,
  onOpen,
}, ref) {
  const effectiveStatus: DesignSurfaceStatus =
    surface.status === 'ready' && (!surface.file || surface.file.kind !== 'html')
      ? 'missing'
      : surface.status;
  const hasPreview = effectiveStatus === 'ready' && surface.file?.kind === 'html';
  const openLabel = labels.openSurface(surface.title);
  return (
    <button
      ref={ref}
      type="button"
      className={[styles.frame, selected ? styles.selectedFrame : ''].filter(Boolean).join(' ')}
      style={style}
      data-surface-id={surface.id}
      data-status={effectiveStatus}
      aria-label={openLabel}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className={styles.preview}>
        {hasPreview && surface.file ? (
          <HtmlPageThumbnail
            projectId={projectId}
            file={surface.file}
            filesRefreshKey={filesRefreshKey}
            fallback={<SurfaceStatusPlaceholder status="ready" labels={labels} />}
            freezeMotion
            allowDownloads={false}
            inert
            className={styles.thumbnail}
          />
        ) : (
          <SurfaceStatusPlaceholder status={effectiveStatus} labels={labels} />
        )}
      </span>
      <span className={styles.caption}>
        <span className={styles.title} title={surface.title}>{surface.title}</span>
        <span className={styles.status} data-status={effectiveStatus}>
          {effectiveStatus === 'generating' ? <Icon name="spinner" size={13} /> : null}
          {effectiveStatus === 'failed' ? <Icon name="alert-triangle" size={13} /> : null}
          {effectiveStatus === 'ready' ? <Icon name="check" size={13} /> : null}
          {effectiveStatus === 'waived' ? <Icon name="minus" size={13} /> : null}
          {labels.status[effectiveStatus]}
        </span>
      </span>
    </button>
  );
});

function SurfaceStatusPlaceholder({
  status,
  labels,
}: {
  status: DesignSurfaceStatus;
  labels: DesignSurfaceCanvasLabels;
}) {
  const icon: IconName = status === 'failed'
    ? 'alert-triangle'
    : status === 'generating'
      ? 'spinner'
      : status === 'queued'
        ? 'history'
        : status === 'waived'
          ? 'minus'
        : 'file-code';
  return (
    <span className={styles.placeholder} data-status={status}>
      <Icon name={icon} size={22} />
      <span>{labels.status[status]}</span>
    </span>
  );
}
