import type { ProjectFile } from '../types';

/** Tab name for a live `<artifact>` HTML stream before any file is on disk. */
export const STREAMING_HTML_PREVIEW_NAME = 'index.html';

export function resolveStreamingHtmlPreviewFile(
  artifactHtml: string | null | undefined,
  files: readonly ProjectFile[],
): ProjectFile | null {
  if (artifactHtml == null) return null;
  const pinned = files.find((file) => file.name === STREAMING_HTML_PREVIEW_NAME);
  if (pinned) return pinned;
  return {
    name: STREAMING_HTML_PREVIEW_NAME,
    path: STREAMING_HTML_PREVIEW_NAME,
    type: 'file',
    // Frozen size: FileViewer keys srcDoc transport by file size; growing
    // length would remount the iframe on every token.
    size: 0,
    mtime: 0,
    kind: 'html',
    mime: 'text/html',
  };
}
