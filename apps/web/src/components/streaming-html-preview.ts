import type { ProjectFile } from '../types';

/** Tab name for a live `<artifact>` HTML stream before any file is on disk. */
export const STREAMING_HTML_PREVIEW_NAME = 'index.html';

export function resolveStreamingHtmlPreviewFile(
  artifactHtml: string | null | undefined,
  files: readonly ProjectFile[],
): ProjectFile | null {
  if (artifactHtml == null) return null;
  const existing = files.find((file) => file.kind === 'html');
  if (existing) return existing;
  return {
    name: STREAMING_HTML_PREVIEW_NAME,
    path: STREAMING_HTML_PREVIEW_NAME,
    type: 'file',
    size: artifactHtml.length,
    mtime: 0,
    kind: 'html',
    mime: 'text/html',
  };
}
