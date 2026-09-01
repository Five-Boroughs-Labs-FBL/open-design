import { describe, expect, it } from 'vitest';
import { extractDataUrlImages } from '../src/extract-data-url-images.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA = `data:image/png;base64,${PNG_B64}`;

describe('extractDataUrlImages', () => {
  it('leaves HTML without data URLs unchanged', () => {
    const html = '<!doctype html><html><img src="assets/hero.png"></html>';
    expect(extractDataUrlImages(html)).toEqual({ html, files: [] });
  });

  it('writes hashed sibling PNG files and rewrites src', () => {
    const html = `<!doctype html><html><img src="${PNG_DATA}"><img src="${PNG_DATA}"></html>`;
    const result = extractDataUrlImages(html, { htmlFileName: 'index.html' });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toMatch(/^assets\/img-[0-9a-f]{16}\.png$/);
    expect(result.files[0].href).toBe(result.files[0].name);
    expect(result.files[0].buffer.subarray(0, 8).equals(
      Buffer.from('89504e470d0a1a0a', 'hex'),
    )).toBe(true);
    expect(result.html).toContain(`src="${result.files[0].href}"`);
    expect(result.html).not.toContain('data:image');
  });

  it('nests assets next to HTML in a subdirectory but keeps src relative', () => {
    const html = `<img src="${PNG_DATA}">`;
    const result = extractDataUrlImages(html, { htmlFileName: 'screens/home.html' });
    expect(result.files[0].name.startsWith('screens/assets/')).toBe(true);
    expect(result.files[0].href).toMatch(/^assets\/img-[0-9a-f]{16}\.png$/);
    expect(result.html).toContain(`src="${result.files[0].href}"`);
    expect(result.html).not.toContain('screens/assets');
  });

  it('accepts whitespace-wrapped base64 and leaves truncated payloads inline', () => {
    const wrapped = PNG_B64.slice(0, 40) + '\n' + PNG_B64.slice(40);
    const wrappedHtml = `<img src="data:image/png;base64,${wrapped}">`;
    const wrappedResult = extractDataUrlImages(wrappedHtml);
    expect(wrappedResult.files).toHaveLength(1);
    expect(wrappedResult.html).not.toContain('data:image');

    const truncatedHtml = `<img src="data:image/png;base64,${PNG_B64.slice(0, 40)}">`;
    const truncated = extractDataUrlImages(truncatedHtml);
    expect(truncated.files).toHaveLength(0);
    expect(truncated.html).toContain('data:image/png');
  });

  it('leaves malformed payloads in place', () => {
    const html = '<img src="data:image/png;base64,%%%">';
    const result = extractDataUrlImages(html);
    expect(result.files).toHaveLength(0);
    expect(result.html).toContain('data:image/png');
  });
});
