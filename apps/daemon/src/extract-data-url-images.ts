import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_EXTRACTED_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_EXTRACTED_IMAGES = 40;

const DATA_URL_RE =
  /data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)/gi;

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
  href: string;
  dataUrl: string;
  buffer: Buffer;
  mimeType: string;
  sha256: string;
}

export interface ExtractDataUrlImagesResult {
  html: string;
  files: ExtractedImageFile[];
}

function decodeBase64Payload(raw: string): Buffer | null {
  const cleaned = String(raw || '').replace(/\s+/g, '');
  if (!cleaned || cleaned.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  try {
    return Buffer.from(cleaned, 'base64');
  } catch {
    return null;
  }
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

function looksLikeCompleteImage(mimeType: string, bytes: Buffer): boolean {
  if (!looksLikeImage(mimeType, bytes)) return false;
  if (mimeType === 'image/png') {
    const iend = Buffer.from('49454e44ae426082', 'hex');
    return bytes.length >= 16 && bytes.subarray(bytes.length - 8).equals(iend);
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mimeType === 'image/gif') {
    return bytes[bytes.length - 1] === 0x3b;
  }
  if (mimeType === 'image/webp') {
    if (bytes.length < 8) return false;
    return bytes.length >= 8 + bytes.readUInt32LE(4);
  }
  if (mimeType === 'image/svg+xml') {
    return /<\/svg>/i.test(bytes.toString('utf8'));
  }
  return true;
}

function assetsDirForHtml(htmlFileName: string): string {
  const dir = path.posix.dirname(String(htmlFileName || '').replace(/\\/g, '/'));
  if (!dir || dir === '.') return 'assets';
  return `${dir}/assets`;
}

/**
 * Split inlined `data:image` payloads out of HTML into sibling files.
 * Idempotent: HTML without data URLs is returned unchanged.
 * Malformed / oversized / truncated payloads are left in place rather than
 * dropping pictures. `name` is the project-relative write path; `href` is the
 * HTML-relative src (always `assets/<file>` next to that screen).
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
  const writeDir = assetsDirForHtml(options.htmlFileName || 'index.html');
  let nextIndex = 1;

  const rewritten = html.replace(DATA_URL_RE, (match, mimeRaw: string, b64: string) => {
    const mimeType = String(mimeRaw || '').toLowerCase();
    const ext = EXT_BY_MIME[mimeType];
    if (!ext) return match;
    const bytes = decodeBase64Payload(b64);
    if (!bytes || !bytes.length || bytes.length > MAX_EXTRACTED_IMAGE_BYTES) return match;
    if (!looksLikeCompleteImage(mimeType, bytes)) return match;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = byHash.get(sha256);
    if (existing) return existing;
    if (files.length >= MAX_EXTRACTED_IMAGES) return match;
    const hrefBase = `img-${sha256.slice(0, 16)}${ext}`;
    let href = `assets/${hrefBase}`;
    let name = `${writeDir}/${hrefBase}`;
    while (usedNames.has(name) || usedNames.has(href)) {
      const extra = `img-${sha256.slice(0, 16)}-${nextIndex}${ext}`;
      href = `assets/${extra}`;
      name = `${writeDir}/${extra}`;
      nextIndex += 1;
    }
    usedNames.add(name);
    usedNames.add(href);
    byHash.set(sha256, href);
    files.push({ name, href, dataUrl: match, buffer: bytes, mimeType, sha256 });
    return href;
  });

  return { html: rewritten, files };
}
