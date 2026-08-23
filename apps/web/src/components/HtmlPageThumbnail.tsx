import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import {
  appendResourceQuery,
  workspaceIdentityCacheKey,
} from '../collab/workspace-identity';
import { useProjectCollabContext } from '../collab/collab-context';
import { projectFileUrl, projectRawUrl } from '../providers/registry';
import { buildSrcdoc } from '../runtime/srcdoc';
import type { ProjectFile } from '../types';
import {
  getHtmlSourceSnapshot,
  htmlSourceSnapshotRefreshKey,
} from './html-source-snapshot-cache';
import {
  getHtmlThumbnailSource,
  loadHtmlThumbnailSource,
} from './html-thumbnail-source-cache';

const HTML_THUMBNAIL_INLINE_MAX_BYTES = 512 * 1024;
const STATIC_THUMBNAIL_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

// At most this many thumbnail source fetches run concurrently. This pool is
// shared by the Design Files grid and manifest canvas so opening a canvas does
// not create a second, independent connection budget.
const MAX_CONCURRENT_HTML_THUMBNAIL_FETCHES = 6;

let activeHtmlThumbnailFetches = 0;
const queuedHtmlThumbnailFetches: Array<() => void> = [];

// Start queued thumbnail fetches on a microtask, never synchronously from a
// release. A synchronous pump would let one card's unmount cleanup start a
// queued fetch for a sibling that is being torn down in the same commit.
function pumpHtmlThumbnailFetchQueue(): void {
  queueMicrotask(() => {
    while (
      activeHtmlThumbnailFetches < MAX_CONCURRENT_HTML_THUMBNAIL_FETCHES
      && queuedHtmlThumbnailFetches.length > 0
    ) {
      queuedHtmlThumbnailFetches.shift()!();
    }
  });
}

/**
 * FIFO concurrency gate for thumbnail content fetches. An abandoned queued
 * reservation is removed. An abandoned in-flight reservation stays counted
 * until its request settles, so navigation churn can never exceed the real
 * network concurrency cap.
 */
function acquireHtmlThumbnailFetchSlot(
  start: (release: () => void) => void,
): () => void {
  let started = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeHtmlThumbnailFetches -= 1;
    pumpHtmlThumbnailFetchQueue();
  };
  const run = () => {
    started = true;
    activeHtmlThumbnailFetches += 1;
    start(release);
  };
  let abandoned = false;
  const abandon = () => {
    if (abandoned || started) return;
    abandoned = true;
    const index = queuedHtmlThumbnailFetches.indexOf(run);
    if (index >= 0) queuedHtmlThumbnailFetches.splice(index, 1);
  };
  if (activeHtmlThumbnailFetches < MAX_CONCURRENT_HTML_THUMBNAIL_FETCHES) {
    run();
  } else {
    queuedHtmlThumbnailFetches.push(run);
  }
  return abandon;
}

// Pages are laid out at a desktop-ish width and scaled down to the host, so a
// thumbnail reads as a zoomed-out page instead of a narrow mobile crop.
export const HTML_PAGE_THUMBNAIL_LAYOUT_WIDTH = 1200;
export const HTML_PAGE_THUMBNAIL_LAYOUT_HEIGHT = Math.round(
  HTML_PAGE_THUMBNAIL_LAYOUT_WIDTH * (9 / 16),
);

export interface HtmlPageThumbnailProps {
  projectId: string;
  file: ProjectFile;
  filesRefreshKey?: number;
  fallback: ReactNode;
  /** Static canvases stop animation/transition repainting in every frame. */
  freezeMotion?: boolean;
  /** Design Files preserves its historical download-capable sandbox. */
  allowDownloads?: boolean;
  /** Canvas previews should never become a second keyboard interaction tree. */
  inert?: boolean;
  className?: string;
}

/**
 * Canvas miniatures are display-only documents, not 60 tiny live previews.
 * The empty iframe sandbox is the security boundary: authored scripts cannot
 * execute even if malformed markup evades the defense-in-depth stripping.
 * CSP also prevents network, frame, form, object, and navigation-adjacent
 * activity. Removing common active markup keeps the document static and
 * avoids needless parsing/work in a large overview.
 */
export function buildStaticHtmlThumbnailDocument(source: string, _baseHref: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${STATIC_THUMBNAIL_CSP}">`;
  const sanitized = buildSrcdoc(source, { freezeMotion: true })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?\s*>/gi, '')
    .replace(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:["']\s*refresh\s*["']|refresh\b))[^>]*>/gi, '')
    .replace(/<(?:iframe|object|applet|portal)\b[^>]*>[\s\S]*?<\/(?:iframe|object|applet|portal)\s*>/gi, '')
    .replace(/<(?:iframe|frame|object|embed|applet|portal)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Put the policy before *all authored markup*. Searching for `<head>` in a
  // string is unsafe because a fake tag in a comment, style, or text node can
  // swallow the policy. HTML's tree builder places this leading metadata in
  // the document head (after the optional doctype) before it sees any
  // attacker-controlled resource URL.
  const doctype = /^\s*<!doctype\b[^>]*>/i.exec(sanitized);
  const insertionPoint = doctype?.[0].length ?? 0;
  return `${sanitized.slice(0, insertionPoint)}${csp}${sanitized.slice(insertionPoint)}`;
}

/**
 * Lightweight HTML miniature shared by the Design Files grid and the design
 * canvas. It deliberately reuses the same source snapshots, thumbnail cache,
 * viewport gate, and FIFO request pool instead of mounting a FileViewer per
 * surface.
 */
export function HtmlPageThumbnail({
  projectId,
  file,
  filesRefreshKey = 0,
  fallback,
  freezeMotion = false,
  allowDownloads = true,
  inert = false,
  className,
}: HtmlPageThumbnailProps) {
  const {
    workspaceContext,
    workspaceContextLoading,
  } = useProjectCollabContext();
  const tooLargeForThumbnail = file.size > HTML_THUMBNAIL_INLINE_MAX_BYTES;
  const url = projectFileUrl(projectId, file.name, workspaceContext);
  const authorizationScopeKey = workspaceContextLoading
    ? null
    : workspaceContext
      ? `workspace:${workspaceIdentityCacheKey(workspaceContext)}`
      : 'local';
  const refreshKey = htmlSourceSnapshotRefreshKey(file, filesRefreshKey);
  const thumbnailIdentity = authorizationScopeKey
    ? {
        authorizationScopeKey,
        projectId,
        fileName: file.name,
        refreshKey,
      }
    : null;
  const baseHref = projectRawUrl(
    projectId,
    baseDirForFile(file.name),
    workspaceContext,
  );
  const buildThumbnailDocument = (source: string) => inert
    ? buildStaticHtmlThumbnailDocument(source, baseHref)
    : buildSrcdoc(source, { baseHref, freezeMotion });
  const [srcDoc, setSrcDoc] = useState<string | null>(() => {
    if (!thumbnailIdentity) return null;
    const source =
      getHtmlSourceSnapshot(
        thumbnailIdentity.authorizationScopeKey,
        thumbnailIdentity.projectId,
        thumbnailIdentity.fileName,
        thumbnailIdentity.refreshKey,
      )?.source
      ?? getHtmlThumbnailSource(thumbnailIdentity);
    return source === null ? null : buildThumbnailDocument(source);
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);

  // Fetch only after the host nears the viewport. Once intersected it stays
  // eligible; environments without IntersectionObserver render immediately.
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (nearViewport) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setNearViewport(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    setSrcDoc(null);
    if (tooLargeForThumbnail || !thumbnailIdentity) return;
    const cachedSource =
      getHtmlSourceSnapshot(
        thumbnailIdentity.authorizationScopeKey,
        thumbnailIdentity.projectId,
        thumbnailIdentity.fileName,
        thumbnailIdentity.refreshKey,
      )?.source
      ?? getHtmlThumbnailSource(thumbnailIdentity);
    if (cachedSource !== null) {
      setSrcDoc(buildThumbnailDocument(cachedSource));
      return;
    }
    if (!nearViewport) return;
    let cancelled = false;
    const abandonSlot = acquireHtmlThumbnailFetchSlot((release) => {
      void loadHtmlThumbnailSource(
        thumbnailIdentity,
        async () => {
          const response = await fetch(
            appendResourceQuery(url, `v=${Math.round(file.mtime)}`),
            {},
          );
          return response?.ok ? response.text() : null;
        },
      ).then((html) => {
          if (cancelled || html === null) return;
          const nextSrcDoc = buildThumbnailDocument(html);
          if (!cancelled) setSrcDoc(nextSrcDoc);
        })
        .catch(() => {
          if (!cancelled) setSrcDoc(null);
        })
        // The settle path is the only place a started request releases its
        // slot. Cleanup merely abandons a not-yet-started reservation.
        .finally(release);
    });
    return () => {
      cancelled = true;
      abandonSlot();
    };
  }, [
    authorizationScopeKey,
    baseHref,
    freezeMotion,
    inert,
    nearViewport,
    refreshKey,
    tooLargeForThumbnail,
    url,
  ]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const width = host.clientWidth;
      if (width > 0) setScale(width / HTML_PAGE_THUMBNAIL_LAYOUT_WIDTH);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className={['df-thumb-scale-host', className].filter(Boolean).join(' ')}
    >
      {tooLargeForThumbnail || srcDoc === null ? fallback : (
        <iframe
          title={file.name}
          srcDoc={srcDoc}
          sandbox={inert ? '' : allowDownloads ? 'allow-scripts allow-downloads' : 'allow-scripts'}
          loading="lazy"
          tabIndex={inert ? -1 : undefined}
          aria-hidden={inert ? true : undefined}
          style={{
            width: HTML_PAGE_THUMBNAIL_LAYOUT_WIDTH,
            height: HTML_PAGE_THUMBNAIL_LAYOUT_HEIGHT,
            ...(inert ? { pointerEvents: 'none' } : {}),
            ...(scale
              ? {
                  transform: `scale(${scale})`,
                  transformOrigin: '0 0',
                }
              : {}),
          }}
        />
      )}
    </div>
  );
}

function baseDirForFile(name: string): string {
  const index = name.lastIndexOf('/');
  return index >= 0 ? name.slice(0, index + 1) : '';
}
