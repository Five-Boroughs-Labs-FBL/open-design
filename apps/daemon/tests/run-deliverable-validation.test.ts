import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateRunDeliverable } from '../src/run-deliverable-validation.js';

const temporaryRoots: string[] = [];

async function projectFixture(
  files: Record<string, string>,
): Promise<{ projectsRoot: string; projectId: string }> {
  const projectsRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'od-deliverable-validation-'),
  );
  temporaryRoots.push(projectsRoot);
  const projectId = 'project-1';
  const projectRoot = path.join(projectsRoot, projectId);
  await fs.mkdir(projectRoot, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(projectRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return { projectsRoot, projectId };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('run deliverable validation', () => {
  it('accepts a readable entry whose file kind matches the project kind', async () => {
    const fixture = await projectFixture({
      'index.html': '<!doctype html><title>Ready</title>',
    });

    await expect(
      validateRunDeliverable({
        ...fixture,
        runStatus: 'succeeded',
        artifactCount: 1,
        projectMetadata: {
          kind: 'prototype',
          entryFile: 'index.html',
        },
      }),
    ).resolves.toMatchObject({
      valid: true,
      validation: 'valid',
      entryFile: 'index.html',
      artifactKind: 'html',
    });
  });

  it('rejects a stale declared entry even when an unrelated artifact was touched', async () => {
    const fixture = await projectFixture({
      'notes.txt': 'unrelated run output',
    });

    await expect(
      validateRunDeliverable({
        ...fixture,
        runStatus: 'succeeded',
        artifactCount: 1,
        projectMetadata: {
          kind: 'prototype',
          entryFile: 'index.html',
        },
      }),
    ).resolves.toEqual({
      valid: false,
      validation: 'entry_missing',
    });
  });

  it('rejects an old declared entry when this run only touched another artifact', async () => {
    const fixture = await projectFixture({
      'index.html': '<!doctype html><title>Old entry</title>',
      'other.html': '<!doctype html><title>Unrelated output</title>',
    });

    await expect(
      validateRunDeliverable({
        ...fixture,
        runStatus: 'succeeded',
        artifactCount: 1,
        touchedPaths: ['other.html'],
        projectMetadata: {
          kind: 'prototype',
          entryFile: 'index.html',
        },
      }),
    ).resolves.toMatchObject({
      valid: false,
      validation: 'entry_not_touched',
      entryFile: 'index.html',
      artifactKind: 'html',
    });
  });

  it('rejects a readable entry whose file kind does not match the project kind', async () => {
    const fixture = await projectFixture({
      'index.html': '<!doctype html><title>Wrong kind</title>',
    });

    await expect(
      validateRunDeliverable({
        ...fixture,
        runStatus: 'succeeded',
        artifactCount: 1,
        projectMetadata: {
          kind: 'image',
          entryFile: 'index.html',
        },
      }),
    ).resolves.toMatchObject({
      valid: false,
      validation: 'type_mismatch',
      entryFile: 'index.html',
      artifactKind: 'html',
    });
  });

  it('does not promote a Studio route or pre-existing file without a run artifact', async () => {
    const fixture = await projectFixture({
      'index.html': '<!doctype html><title>Old artifact</title>',
    });

    await expect(
      validateRunDeliverable({
        ...fixture,
        runStatus: 'succeeded',
        artifactCount: 0,
        projectMetadata: {
          kind: 'prototype',
          entryFile: 'index.html',
        },
      }),
    ).resolves.toEqual({
      valid: false,
      validation: 'no_artifact',
    });
  });

  it('accepts exact touched secondary target files without requiring index.html', async () => {
    const fixture = await projectFixture({
      'screens/billing.html': '<!doctype html><title>Billing</title>',
      'screens/settings.html': '<!doctype html><title>Settings</title>',
    });

    await expect(validateRunDeliverable({
      ...fixture,
      runStatus: 'succeeded',
      artifactCount: 2,
      targetFiles: ['screens/billing.html', 'screens/settings.html'],
      touchedPaths: ['screens/billing.html', 'screens/settings.html'],
      projectMetadata: { kind: 'prototype', entryFile: 'index.html' },
    })).resolves.toMatchObject({
      valid: true,
      validation: 'valid',
      entryFile: 'screens/billing.html',
      artifactKind: 'html',
    });
  });

  it('resolves one portable case and Unicode alias back to the actual project file', async () => {
    const fixture = await projectFixture({
      'Screens/Cafe\u0301.HTML': '<!doctype html><title>Caf\u00e9</title>',
    });

    await expect(validateRunDeliverable({
      ...fixture,
      runStatus: 'succeeded',
      artifactCount: 1,
      targetFiles: ['screens/caf\u00e9.html'],
      touchedPaths: ['Screens/Cafe\u0301.HTML'],
      projectMetadata: { kind: 'prototype', entryFile: 'index.html' },
    })).resolves.toMatchObject({
      valid: true,
      validation: 'valid',
      entryFile: 'screens/caf\u00e9.html',
      artifactKind: 'html',
    });
  });

  it('rejects a scoped batch when any claimed secondary file was not touched', async () => {
    const fixture = await projectFixture({
      'screens/billing.html': '<!doctype html><title>Billing</title>',
      'screens/settings.html': '<!doctype html><title>Old settings</title>',
    });

    await expect(validateRunDeliverable({
      ...fixture,
      runStatus: 'succeeded',
      artifactCount: 1,
      targetFiles: ['screens/billing.html', 'screens/settings.html'],
      touchedPaths: ['screens/billing.html'],
      projectMetadata: { kind: 'prototype', entryFile: 'index.html' },
    })).resolves.toMatchObject({
      valid: false,
      validation: 'entry_not_touched',
      entryFile: 'screens/billing.html',
    });
  });

  it('fails closed when a scoped runtime cannot provide touched paths', async () => {
    const fixture = await projectFixture({
      'screens/billing.html': '<!doctype html><title>Billing</title>',
    });

    await expect(validateRunDeliverable({
      ...fixture,
      runStatus: 'succeeded',
      artifactCount: 1,
      targetFiles: ['screens/billing.html'],
      projectMetadata: { kind: 'prototype', entryFile: 'index.html' },
    })).resolves.toMatchObject({
      valid: false,
      validation: 'entry_not_touched',
      entryFile: 'screens/billing.html',
    });
  });

  it('rejects a scoped batch that also writes an unclaimed HTML surface', async () => {
    const fixture = await projectFixture({
      'screens/billing.html': '<!doctype html><title>Billing</title>',
      'screens/settings.html': '<!doctype html><title>Settings</title>',
    });

    await expect(validateRunDeliverable({
      ...fixture,
      runStatus: 'succeeded',
      artifactCount: 2,
      targetFiles: ['screens/billing.html'],
      touchedPaths: ['screens/billing.html', 'screens/settings.html'],
      projectMetadata: { kind: 'prototype', entryFile: 'index.html' },
    })).resolves.toMatchObject({
      valid: false,
      validation: 'unexpected_artifact',
      entryFile: 'screens/settings.html',
    });
  });

  it('rejects a scoped run that tries to modify daemon-owned manifest state', async () => {
    const fixture = await projectFixture({
      'screens/billing.html': '<!doctype html><title>Billing</title>',
      'DESIGN-MANIFEST.json': '{}',
    });

    await expect(validateRunDeliverable({
      ...fixture,
      runStatus: 'succeeded',
      artifactCount: 2,
      targetFiles: ['screens/billing.html'],
      touchedPaths: ['screens/billing.html', 'DESIGN-MANIFEST.json'],
      projectMetadata: { kind: 'prototype', entryFile: 'index.html' },
    })).resolves.toMatchObject({
      valid: false,
      validation: 'unexpected_artifact',
      entryFile: 'DESIGN-MANIFEST.json',
    });
  });
});
