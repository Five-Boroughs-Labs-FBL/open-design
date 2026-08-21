import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../../src/types';
import {
  STREAMING_HTML_PREVIEW_NAME,
  resolveStreamingHtmlPreviewFile,
} from '../../src/components/streaming-html-preview';

function file(name: string, kind: ProjectFile['kind'] = 'html'): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 1,
    mtime: 1,
    kind,
    mime: kind === 'html' ? 'text/html' : 'text/plain',
  };
}

describe('resolveStreamingHtmlPreviewFile', () => {
  it('is idle when no artifact is streaming', () => {
    expect(resolveStreamingHtmlPreviewFile(null, [])).toBeNull();
    expect(resolveStreamingHtmlPreviewFile(undefined, [file('index.html')])).toBeNull();
  });

  it('synthesizes index.html on an empty canvas so FileViewer can take liveHtml', () => {
    const preview = resolveStreamingHtmlPreviewFile('<h1>HUD</h1>', []);
    expect(preview).toMatchObject({
      name: STREAMING_HTML_PREVIEW_NAME,
      kind: 'html',
      mime: 'text/html',
    });
    expect(preview?.size).toBe(0);
    expect(resolveStreamingHtmlPreviewFile('<h1>HUD</h1> and a much longer body', [])?.size).toBe(0);
  });

  it('reuses the first existing HTML file instead of minting a second tab', () => {
    const cover = file('cover.html');
    expect(resolveStreamingHtmlPreviewFile('<p>next</p>', [
      file('notes.md', 'text'),
      cover,
    ])).toBe(cover);
  });
});
