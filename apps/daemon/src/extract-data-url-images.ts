import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_EXTRACTED_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_EXTRACTED_IMAGES = 40;

const DATA_URL_RE =
  /data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})/gi;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

export interface ExtractedImageFile {
  name: string;
  buffer: Buffer;
  mimeType: string;
  sha256: string;
}

export interface ExtractDataUrlImagesResult {
  html: string;
  files: ExtractedImageFile[];
}

function looksLikeImage(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return (
      bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'image/gif') {
    const head = bytes.subarray(0, 6).toString('ascii');
    return head === 'GIF87a' || head === 'GIF89a';
  }
  if (mimeType === 'image/svg+xml') {
    const text = bytes.toString('utf8').trimStart();
    return text.startsWith('<svg') || text.startsWith('<?xml');
  }
  return false;
}

function assetsDirForHtml(htmlFileName: string): string {
  const dir = path.posix.dirname(String(htmlFileName || '').replace(/\\/g, '/'));
  if (!dir || dir === '.') return 'assets';
  return `${dir}/assets`;
}

/**
 * Split inlined `data:image` payloads out of HTML into sibling files.
 * Idempotent: HTML without data URLs is returned unchanged.
 * Malformed / oversized payloads are left in place rather than dropping pictures.
 */
export function extractDataUrlImages(
  html: string,
  options: { htmlFileName?: string } = {},
): ExtractDataUrlImagesResult {
  if (typeof html !== 'string' || !/data:image\//i.test(html)) {
    return { html, files: [] };
  }
  const files: ExtractedImageFile[] = [];
  const byHash = new Map<string, string>();
  const usedNames = new Set<string>();
  const prefix = assetsDirForHtml(options.htmlFileName || 'index.html');
  let nextIndex = 1;

  const rewritten = html.replace(DATA_URL_RE, (match, mimeRaw: string, b64: string) => {
    if (files.length >= MAX_EXTRACTED_IMAGES) return match;
    const mimeType = String(mimeRaw || '').toLowerCase();
    const ext = EXT_BY_MIME[mimeType];
    if (!ext) return match;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, 'base64');
    } catch {
      return match;
    }
    if (!bytes.length || bytes.length > MAX_EXTRACTED_IMAGE_BYTES) return match;
    if (!looksLikeImage(mimeType, bytes)) return match;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = byHash.get(sha256);
    if (existing) return existing;
    let name = `${prefix}/img-${sha256.slice(0, 16)}${ext}`;
    while (usedNames.has(name)) {
      name = `${prefix}/img-${sha256.slice(0, 16)}-${nextIndex}${ext}`;
      nextIndex += 1;
    }
    usedNames.add(name);
    byHash.set(sha256, name);
    files.push({ name, buffer: bytes, mimeType, sha256 });
    return name;
  });

  return { html: rewritten, files };
}
