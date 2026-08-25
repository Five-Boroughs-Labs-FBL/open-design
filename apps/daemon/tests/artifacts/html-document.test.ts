import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isMixedHtmlDocument,
  isSingleHtmlDocument,
  unwrapSingleHtmlArtifactEnvelope,
} from '../../src/artifacts/html-document.js';
import { writeProjectFile } from '../../src/projects.js';
import {
  ARTIFACT_ENVELOPE_LEAK_HTML,
  ARTIFACT_ENVELOPE_LEAK_OPEN_HTML,
  ARTIFACT_ENVELOPE_MIXED_INNER_HTML,
  CLEAN_LOGIN_HTML,
  LIVE_PRIMARY_LEAK_HTML,
  MOBILE_LOGIN_HTML,
} from './html-document.fixtures.js';

describe('isMixedHtmlDocument', () => {
  it('rejects the leaked later-turn shape: DOCTYPE + thinking in style + ```html + second DOCTYPE', () => {
    expect(LIVE_PRIMARY_LEAK_HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(isMixedHtmlDocument(LIVE_PRIMARY_LEAK_HTML)).toBe(true);
    expect(isSingleHtmlDocument(LIVE_PRIMARY_LEAK_HTML)).toBe(false);
  });

  it('rejects a second DOCTYPE even without a markdown fence', () => {
    const mixed = [
      '<!doctype html><html><body>One</body></html>',
      '<!doctype html><html><body>Two</body></html>',
    ].join('\n');
    expect(isMixedHtmlDocument(mixed)).toBe(true);
  });

  it('rejects ```html that opens a nested document', () => {
    const mixed = [
      '<!doctype html><html><head><title>x</title></head><body>',
      '```html',
      '<html><body>Nested</body></html>',
      '</body></html>',
    ].join('\n');
    expect(isMixedHtmlDocument(mixed)).toBe(true);
  });

  it('rejects a style block that contains markup or a fence', () => {
    const mixed = [
      '<!doctype html><html><head><style>',
      'body{color:#111}',
      '```html',
      '</style></head><body>Hi</body></html>',
    ].join('\n');
    expect(isMixedHtmlDocument(mixed)).toBe(true);
  });

  it('accepts a single complete document', () => {
    expect(isMixedHtmlDocument(CLEAN_LOGIN_HTML)).toBe(false);
    expect(isSingleHtmlDocument(CLEAN_LOGIN_HTML)).toBe(true);
  });

  it('accepts a streaming single-document draft', () => {
    const draft = '<!doctype html><html><head><style>body{color:#111}';
    expect(isMixedHtmlDocument(draft)).toBe(false);
    expect(isSingleHtmlDocument(draft)).toBe(true);
  });

  it('treats the artifact-envelope + second-doctype leak as mixed until unwrapped', () => {
    expect(ARTIFACT_ENVELOPE_LEAK_HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(ARTIFACT_ENVELOPE_LEAK_HTML).toContain('<artifact identifier="login" type="text/html"');
    expect(countDoctypes(ARTIFACT_ENVELOPE_LEAK_HTML)).toBe(2);
    expect(isMixedHtmlDocument(ARTIFACT_ENVELOPE_LEAK_HTML)).toBe(true);
    expect(isSingleHtmlDocument(ARTIFACT_ENVELOPE_LEAK_HTML)).toBe(false);
  });
});

function countDoctypes(content: string): number {
  return content.match(/<!doctype\s+html\b/gi)?.length ?? 0;
}

describe('unwrapSingleHtmlArtifactEnvelope', () => {
  it('unwraps a single artifact envelope and returns only the inner HTML document', () => {
    const inner = unwrapSingleHtmlArtifactEnvelope(ARTIFACT_ENVELOPE_LEAK_HTML);
    expect(inner).toBe(MOBILE_LOGIN_HTML);
    expect(inner).not.toContain('<artifact');
    expect(isSingleHtmlDocument(inner!)).toBe(true);
    expect(inner).toContain('--tap:52px');
    expect(unwrapSingleHtmlArtifactEnvelope(ARTIFACT_ENVELOPE_LEAK_OPEN_HTML)).toBe(MOBILE_LOGIN_HTML);
  });

  it('returns null when the inner page is still mixed', () => {
    expect(unwrapSingleHtmlArtifactEnvelope(ARTIFACT_ENVELOPE_MIXED_INNER_HTML)).toBeNull();
  });

  it('returns null for a single document with no envelope', () => {
    expect(unwrapSingleHtmlArtifactEnvelope(CLEAN_LOGIN_HTML)).toBeNull();
  });
});

describe('writeProjectFile mixed HTML', () => {
  it('keeps the previous single document instead of writing the leak', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-html-mixed-write-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, 'index.html'), CLEAN_LOGIN_HTML);
      const written = await writeProjectFile(
        projectsRoot,
        'project-1',
        'index.html',
        Buffer.from(LIVE_PRIMARY_LEAK_HTML, 'utf8'),
        { overwrite: true },
      );
      expect(written.name).toBe('index.html');
      expect(await readFile(path.join(projectDir, 'index.html'), 'utf8')).toBe(CLEAN_LOGIN_HTML);
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('refuses to create a mixed document when there is no previous file', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-html-mixed-create-'));
    try {
      await expect(writeProjectFile(
        projectsRoot,
        'project-1',
        'index.html',
        Buffer.from(LIVE_PRIMARY_LEAK_HTML, 'utf8'),
        { overwrite: true },
      )).rejects.toThrow('refused to persist a mixed HTML document');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });
});
