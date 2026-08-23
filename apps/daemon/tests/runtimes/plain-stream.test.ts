import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LIVE_HTML_CANVAS_NAME,
  extractLiveHtmlCanvasArtifact,
  extractOpenPlainStreamArtifact,
  extractPlainStreamArtifacts,
  persistLiveHtmlCanvas,
  persistPlainStreamArtifacts,
  persistPlainStreamArtifactList,
  plainStdoutFromRunEvents,
  withoutLiveHtmlCanvasArtifact,
} from '../../src/runtimes/plain-stream.js';
import { listFiles, writeProjectFile } from '../../src/projects.js';

describe('plain stream artifact extraction', () => {
  it('extracts and writes artifact tags from plain stdout into project files', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-plain-stream-'));
    try {
      const stdout = [
        'Here is the result:\n',
        '<artifact identifier="flowmind-landing" type="text/html" title="FlowMind Landing">',
        '<!doctype html><html><body><h1>FlowMind</h1></body></html>',
        '</artifact>',
        '\nDone.',
      ].join('');

      const written = await persistPlainStreamArtifacts({
        projectsRoot,
        projectId: 'project-1',
        stdout,
        writeProjectFile: writeProjectFile as any,
      });

      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        name: 'flowmind-landing.html',
        identifier: 'flowmind-landing',
        artifactType: 'text/html',
      });

      const body = await readFile(
        path.join(projectsRoot, 'project-1', 'flowmind-landing.html'),
        'utf8',
      );
      expect(body).toContain('<h1>FlowMind</h1>');

      const files = await listFiles(projectsRoot, 'project-1');
      const file = files.find((candidate) => candidate.name === 'flowmind-landing.html');
      expect(file?.artifactManifest).toMatchObject({
        kind: 'html',
        renderer: 'html',
        entry: 'flowmind-landing.html',
        metadata: {
          identifier: 'flowmind-landing',
          artifactType: 'text/html',
          inferred: false,
        },
      });
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('does not write files when plain stdout contains no artifact tags', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-plain-stream-'));
    try {
      const written = await persistPlainStreamArtifacts({
        projectsRoot,
        projectId: 'project-1',
        stdout: 'plain answer with no file output',
        writeProjectFile: writeProjectFile as any,
      });

      expect(written).toEqual([]);
      await expect(listFiles(projectsRoot, 'project-1')).resolves.toEqual([]);
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('infers html artifacts without a type and avoids filename collisions', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-plain-stream-'));
    try {
      await mkdir(path.join(projectsRoot, 'project-1'), { recursive: true });
      await writeFile(path.join(projectsRoot, 'project-1', 'landing.html'), 'existing');

      const written = await persistPlainStreamArtifacts({
        projectsRoot,
        projectId: 'project-1',
        stdout: [
          '<artifact identifier="landing" title="Landing">',
          '<!doctype html><html><body>New</body></html>',
          '</artifact>',
        ].join(''),
        writeProjectFile: writeProjectFile as any,
      });

      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        name: 'landing-2.html',
        artifactType: 'text/html',
      });
      await expect(readFile(path.join(projectsRoot, 'project-1', 'landing.html'), 'utf8'))
        .resolves.toBe('existing');
      await expect(readFile(path.join(projectsRoot, 'project-1', 'landing-2.html'), 'utf8'))
        .resolves.toContain('<body>New</body>');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('ignores bare artifact tags to match the web artifact parser', () => {
    const artifacts = extractPlainStreamArtifacts([
      '<artifact><!doctype html><html><body>Bare</body></html></artifact>',
      '<artifact identifier="real" type="text/html"><!doctype html><html><body>Real</body></html></artifact>',
    ].join('\n'));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe('real.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('maps supported text artifact types to stable project file names', () => {
    const artifacts = extractPlainStreamArtifacts([
      '<artifact identifier="theme" type="text/css">body { color: red; }</artifact>',
      '<artifact identifier="logo" type="image/svg+xml"><svg /></artifact>',
      '<artifact identifier="brief" type="text/markdown"># Brief</artifact>',
    ].join('\n'));

    expect(artifacts.map((artifact) => ({
      name: artifact.fileName,
      type: artifact.artifactType,
    }))).toEqual([
      { name: 'theme.css', type: 'text/css' },
      { name: 'logo.svg', type: 'image/svg+xml' },
      { name: 'brief.md', type: 'text/markdown' },
    ]);
  });

  it('reconstructs only plain stdout events and ignores literal code-fence examples', () => {
    const stdout = plainStdoutFromRunEvents([
      { event: 'agent', data: { type: 'text_delta', delta: '<artifact type="text/html">no</artifact>' } },
      { event: 'stdout', data: { chunk: '```html\n<artifact type="text/html">example</artifact>\n```\n' } },
      { event: 'stdout', data: { chunk: '<artifact type="text/html"><!doctype html><html></html></artifact>' } },
    ]);

    const artifacts = extractPlainStreamArtifacts(stdout);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.content).toBe('<!doctype html><html></html>');
  });

  it('extracts artifact tags inside indented backtick examples to match web markdown context', () => {
    const artifacts = extractPlainStreamArtifacts([
      '- Literal example:\n',
      '   ```html\n',
      '   <artifact type="text/html"><!doctype html><html><body>Example</body></html></artifact>\n',
      '<artifact identifier="real" type="text/html"><!doctype html><html><body>Real</body></html></artifact>',
    ].join(''));

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.fileName).toBe('artifact.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Example</body></html>');
    expect(artifacts[1]?.fileName).toBe('real.html');
    expect(artifacts[1]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('extracts artifact tags inside tilde fences to match web markdown context', () => {
    const artifacts = extractPlainStreamArtifacts([
      '~~~html\n',
      '<artifact type="text/html"><!doctype html><html><body>Tilde</body></html></artifact>\n',
      '~~~\n',
      '<artifact identifier="real" type="text/html"><!doctype html><html><body>Real</body></html></artifact>',
    ].join(''));

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.fileName).toBe('artifact.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Tilde</body></html>');
    expect(artifacts[1]?.fileName).toBe('real.html');
    expect(artifacts[1]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('ignores artifact tags inside inline markdown code spans', () => {
    const artifacts = extractPlainStreamArtifacts([
      'Use `<artifact identifier="example" type="text/html">example</artifact>` to emit HTML.\n',
      '<artifact identifier="real" type="text/html"><!doctype html><html><body>Real</body></html></artifact>',
    ].join(''));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe('real.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('resyncs past prose artifact openers before a valid artifact block', () => {
    const artifacts = extractPlainStreamArtifacts([
      'Use <artifact type="text/html"> in prose before emitting the real artifact.\n',
      '<artifact identifier="real" type="text/html">',
      '<!doctype html><html><body>Real</body></html>',
      '</artifact>',
    ].join(''));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe('real.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('resyncs past malformed artifact openers before a valid artifact block', () => {
    const artifacts = extractPlainStreamArtifacts([
      'Malformed protocol example: <artifact type="text/html"\n',
      '<artifact identifier="real" type="text/html">',
      '<!doctype html><html><body>Real</body></html>',
      '</artifact>',
    ].join(''));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe('real.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('does not let unmatched backticks hide artifact tags in later paragraphs', () => {
    const artifacts = extractPlainStreamArtifacts([
      'Intro with a stray ` backtick.',
      '',
      '<artifact identifier="real" type="text/html"><!doctype html><html><body>Real</body></html></artifact>',
      '',
      'Another stray ` backtick later.',
    ].join('\n'));

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe('real.html');
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>Real</body></html>');
  });

  it('skips unclosed HTML artifacts in the closed extractor', () => {
    expect(extractPlainStreamArtifacts(
      '<artifact identifier="hud" type="text/html"><!doctype html><html><body><h1>HUD',
    )).toEqual([]);
  });

  it('keeps thought HTML that arrives before the <artifact> wrapper', () => {
    const live = extractLiveHtmlCanvasArtifact([
      '<!doctype html><html><body><h1>HUD</h1></body></html>',
      '<artifact identifier="index" type="text/html">',
    ].join(''));
    expect(live?.fileName).toBe(LIVE_HTML_CANVAS_NAME);
    expect(live?.content).toContain('<h1>HUD</h1>');
    expect(live?.content).not.toContain('<artifact');
  });

  it('prefers a closed tagged artifact over a longer thought document', () => {
    const thought = `<!doctype html><html><body>${'thought '.repeat(40)}</body></html>`;
    const tagged = '<!doctype html><html><body>NEW</body></html>';
    const live = extractLiveHtmlCanvasArtifact(
      `${thought}<artifact identifier="fresh-screen" type="text/html">${tagged}</artifact>`,
    );
    expect(live?.identifier).toBe('fresh-screen');
    expect(live?.fileName).toBe(LIVE_HTML_CANVAS_NAME);
    expect(live?.content).toBe(tagged);
    expect(live?.content).not.toContain('thought');
  });

  it('drops prose after </html> and keeps the last bare document', () => {
    const first = '<!doctype html><html><body>One</body></html>';
    const second = '<!doctype html><html><body>Two</body></html>';
    const live = extractLiveHtmlCanvasArtifact(
      `${first}\nStill thinking about layout.\n${second}\nThen write DESIGN.md.`,
    );
    expect(live?.content).toBe(second);
    expect(live?.content).not.toContain('DESIGN.md');
    expect(live?.content).not.toContain('One');
  });

  it('extracts an open HTML artifact for the live canvas', () => {
    const open = extractOpenPlainStreamArtifact(
      '<artifact identifier="hud" type="text/html"><!doctype html><html><body><h1>HUD',
    );
    expect(open).toMatchObject({
      identifier: 'hud',
      fileName: LIVE_HTML_CANVAS_NAME,
      content: '<!doctype html><html><body><h1>HUD',
    });
    const live = extractLiveHtmlCanvasArtifact(
      '<artifact identifier="hud" type="text/html"><!doctype html><html><body><h1>HUD</h1></body></html></artifact>',
    );
    expect(live?.fileName).toBe(LIVE_HTML_CANVAS_NAME);
    expect(live?.content).toContain('<h1>HUD</h1>');
  });

  it('keeps extra screens after the live canvas already wrote index.html', async () => {
    const stdout = [
      '<artifact identifier="index" type="text/html" title="primary">',
      '<!doctype html><html><body>Map</body></html>',
      '</artifact>',
      '<artifact identifier="screen-2" type="text/html" title="character">',
      '<!doctype html><html><body>Hero</body></html>',
      '</artifact>',
      '<artifact identifier="screen-3" type="text/html" title="hud">',
      '<!doctype html><html><body>HUD</body></html>',
      '</artifact>',
    ].join('');
    const extracted = extractPlainStreamArtifacts(stdout);
    expect(extracted.map((artifact) => artifact.fileName)).toEqual([
      'index.html',
      'screen-2.html',
      'screen-3.html',
    ]);
    const extras = withoutLiveHtmlCanvasArtifact(extracted);
    expect(extras.map((artifact) => artifact.fileName)).toEqual([
      'screen-2.html',
      'screen-3.html',
    ]);

    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-extra-screens-'));
    try {
      await persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact: extractLiveHtmlCanvasArtifact(stdout)!,
        status: 'complete',
        writeProjectFile: writeProjectFile as any,
      });
      const written = await persistPlainStreamArtifactList({
        projectsRoot,
        projectId: 'project-1',
        artifacts: extras,
        writeProjectFile: writeProjectFile as any,
      });
      expect(written.map((file) => file.name)).toEqual(['screen-2.html', 'screen-3.html']);
      const files = await listFiles(projectsRoot, 'project-1');
      expect(files.filter((file) => file.name.endsWith('.html')).map((file) => file.name).sort())
        .toEqual(['index.html', 'screen-2.html', 'screen-3.html']);
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('overwrites index.html in place instead of unique-naming', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-html-canvas-'));
    try {
      const first = extractLiveHtmlCanvasArtifact(
        '<artifact identifier="hud" type="text/html"><!doctype html><html><body>A',
      );
      expect(first).toBeTruthy();
      await persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact: first!,
        status: 'streaming',
        writeProjectFile: writeProjectFile as any,
      });
      const second = extractLiveHtmlCanvasArtifact(
        '<artifact identifier="hud" type="text/html"><!doctype html><html><body>AB</body></html></artifact>',
      );
      const written = await persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact: second!,
        status: 'complete',
        writeProjectFile: writeProjectFile as any,
      });
      expect(written.name).toBe(LIVE_HTML_CANVAS_NAME);
      const files = await listFiles(projectsRoot, 'project-1');
      expect(files.filter((file) => file.name.endsWith('.html')).map((file) => file.name))
        .toEqual([LIVE_HTML_CANVAS_NAME]);
      const body = await readFile(path.join(projectsRoot, 'project-1', LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toContain('AB');
      expect(files[0]?.artifactManifest).toMatchObject({ status: 'complete', entry: LIVE_HTML_CANVAS_NAME });
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('overwrites only exact targeted stable files and ignores a generic artifact', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-targeted-screens-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(path.join(projectDir, 'screens'), { recursive: true });
      await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><title>Entry</title>');
      await writeFile(path.join(projectDir, 'screens', 'billing.html'), '<!doctype html><title>Old</title>');
      const artifacts = extractPlainStreamArtifacts([
        '<artifact identifier="generic" type="text/html"><!doctype html><title>Wrong</title></artifact>',
        '<artifact identifier="billing" type="text/html"><!doctype html><title>New</title></artifact>',
      ].join(''));

      const written = await persistPlainStreamArtifactList({
        projectsRoot,
        projectId: 'project-1',
        artifacts,
        targets: [{ surfaceId: 'billing', file: 'screens/billing.html' }],
        writeProjectFile: writeProjectFile as any,
      });

      expect(written.map((file) => file.name)).toEqual(['screens/billing.html']);
      expect(await readFile(path.join(projectDir, 'screens', 'billing.html'), 'utf8')).toContain('New');
      expect(await readFile(path.join(projectDir, 'index.html'), 'utf8')).toContain('Entry');
      expect((await listFiles(projectsRoot, 'project-1')).some((file) => file.name === 'generic.html'))
        .toBe(false);
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('streams a targeted secondary surface without overwriting index.html', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-targeted-live-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(path.join(projectDir, 'screens'), { recursive: true });
      await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><title>Entry</title>');
      const artifact = extractLiveHtmlCanvasArtifact(
        '<artifact identifier="billing" type="text/html"><!doctype html><title>Billing</title></artifact>',
      )!;
      await persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact,
        status: 'complete',
        target: { surfaceId: 'billing', file: 'screens/billing.html' },
        writeProjectFile: writeProjectFile as any,
      });

      expect(await readFile(path.join(projectDir, 'index.html'), 'utf8')).toContain('Entry');
      expect(await readFile(path.join(projectDir, 'screens', 'billing.html'), 'utf8')).toContain('Billing');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('refuses a generic live artifact for a claimed secondary surface', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-targeted-live-mismatch-'));
    try {
      const artifact = extractLiveHtmlCanvasArtifact(
        '<artifact identifier="generic" type="text/html"><!doctype html><title>Wrong</title></artifact>',
      )!;
      await expect(persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact,
        status: 'complete',
        target: { surfaceId: 'billing', file: 'screens/billing.html' },
        writeProjectFile: writeProjectFile as any,
      })).rejects.toThrow('does not match claimed surface billing');
      await expect(readFile(
        path.join(projectsRoot, 'project-1', 'screens', 'billing.html'),
        'utf8',
      )).rejects.toThrow();
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('does not let a wrong identifier claim a target through its filename', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-targeted-id-authority-'));
    try {
      const projectDir = path.join(projectsRoot, 'project-1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><title>Original</title>');
      const wrong = {
        ...extractLiveHtmlCanvasArtifact(
          '<artifact identifier="other-surface" type="text/html"><!doctype html><title>Wrong</title></artifact>',
        )!,
        fileName: 'index.html',
        declaredFileName: 'index.html',
      };

      await expect(persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact: wrong,
        status: 'complete',
        target: { surfaceId: 'dashboard', file: 'index.html' },
        writeProjectFile: writeProjectFile as any,
      })).rejects.toThrow('does not match claimed surface dashboard');

      const written = await persistPlainStreamArtifactList({
        projectsRoot,
        projectId: 'project-1',
        artifacts: [wrong],
        targets: [{ surfaceId: 'dashboard', file: 'index.html' }],
        writeProjectFile: writeProjectFile as any,
      });
      expect(written).toEqual([]);
      expect(await readFile(path.join(projectDir, 'index.html'), 'utf8')).toContain('Original');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('writes streaming drafts that still contain publication placeholders', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-live-html-placeholder-'));
    try {
      const draft = extractLiveHtmlCanvasArtifact(
        '<artifact type="text/html"><!doctype html><html><body>Name to confirm',
      );
      expect(draft).toBeTruthy();
      await persistLiveHtmlCanvas({
        projectsRoot,
        projectId: 'project-1',
        artifact: draft!,
        status: 'streaming',
        writeProjectFile: writeProjectFile as any,
      });
      const body = await readFile(path.join(projectsRoot, 'project-1', LIVE_HTML_CANVAS_NAME), 'utf8');
      expect(body).toContain('Name to confirm');
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });
});
