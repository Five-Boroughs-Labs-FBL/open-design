import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isMixedHtmlDocument,
  isSingleHtmlDocument,
} from '../../src/artifacts/html-document.js';
import { writeProjectFile } from '../../src/projects.js';
import { CLEAN_LOGIN_HTML, LIVE_PRIMARY_LEAK_HTML } from './html-document.fixtures.js';

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
