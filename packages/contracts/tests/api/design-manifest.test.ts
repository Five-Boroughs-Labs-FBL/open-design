import { describe, expect, it } from 'vitest';
import {
  DesignManifestValidationError,
  designManifestPathIdentity,
  parseDesignGenerationTarget,
  parseDesignManifestV2,
} from '../../src/api/design-manifest.js';

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'open-design.design-manifest.v2',
    revision: 1,
    projectId: 'project-1',
    entrySurfaceId: 'dashboard',
    scope: {
      schema: 'amc.design-scope.v1',
      scopeId: 'scope-1',
      revision: 1,
      intentDigest: 'sha256:abc',
    },
    directionStatus: 'locked',
    surfaces: [
      {
        id: 'dashboard',
        title: 'Dashboard',
        purpose: 'Summarize product activity',
        priority: 'primary',
        kind: 'screen',
        file: 'index.html',
        status: 'complete',
        required: true,
        states: [
          { id: 'populated', label: 'Populated', required: true },
          { id: 'empty', label: 'Empty', required: true },
        ],
        formFactors: ['desktop', 'mobile'],
        latestRunId: 'run-1',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: 'billing',
        title: 'Billing',
        purpose: 'Manage subscription status',
        priority: 'required',
        kind: 'screen',
        file: 'screens/billing.html',
        status: 'queued',
        required: true,
        states: [],
        formFactors: ['desktop'],
        latestRunId: null,
        updatedAt: null,
      },
    ],
    ...overrides,
  };
}

describe('parseDesignManifestV2', () => {
  it('normalizes arrays and derives coverage from status plus committed files', () => {
    const parsed = parseDesignManifestV2(manifest({
      coverage: { required: 999, ready: true },
    }), {
      projectId: 'project-1',
      projectFiles: ['index.html'],
    });

    expect(parsed.surfaces[0]).toMatchObject({
      purpose: 'Summarize product activity',
      priority: 'primary',
      kind: 'screen',
      states: [
        { id: 'populated', label: 'Populated', required: true },
        { id: 'empty', label: 'Empty', required: true },
      ],
    });
    expect(parsed.surfaces.map((surface) => surface.filePresent)).toEqual([true, false]);
    expect(parsed.coverage).toEqual({
      required: 2,
      complete: 1,
      failed: 0,
      waived: 0,
      pending: 1,
      missingSurfaceIds: ['billing'],
      percent: 50,
      ready: false,
    });
  });

  it('does not count a declared-complete surface whose file is absent', () => {
    const parsed = parseDesignManifestV2(manifest(), { projectFiles: [] });
    expect(parsed.coverage.complete).toBe(0);
    expect(parsed.coverage.missingSurfaceIds).toEqual(['dashboard', 'billing']);
  });

  it('treats an explicit waiver as resolved partial coverage', () => {
    const source = manifest({
      surfaces: [
        { ...manifest().surfaces[0], formFactors: ['responsive'] },
        { ...manifest().surfaces[1], status: 'waived' },
      ],
    });
    const parsed = parseDesignManifestV2(source, { projectFiles: ['index.html'] });
    expect(parsed.coverage).toMatchObject({
      complete: 1,
      waived: 1,
      pending: 0,
      missingSurfaceIds: [],
      percent: 100,
      ready: true,
    });
  });

  it.each([
    ['unsafe paths', { surfaces: [{ ...manifest().surfaces[0], file: '../index.html' }] }],
    ['hidden path segments', { surfaces: [{ ...manifest().surfaces[0], file: '.private/index.html' }] }],
    ['reserved path segments', { surfaces: [{ ...manifest().surfaces[0], file: 'CON/index.html' }] }],
    ['Windows trailing dots', { surfaces: [{ ...manifest().surfaces[0], file: 'screens./index.html' }] }],
    ['Windows trailing spaces', { surfaces: [{ ...manifest().surfaces[0], file: 'screens /index.html' }] }],
    ['Windows forbidden characters', { surfaces: [{ ...manifest().surfaces[0], file: 'screens/bad?.html' }] }],
    ['Windows control characters', { surfaces: [{ ...manifest().surfaces[0], file: 'screens/bad\u0001.html' }] }],
    ['non-HTML surfaces', { surfaces: [{ ...manifest().surfaces[0], file: 'index.svg' }] }],
    ['duplicate ids', { surfaces: [manifest().surfaces[0], { ...manifest().surfaces[1], id: 'dashboard' }] }],
    ['duplicate files', { surfaces: [manifest().surfaces[0], { ...manifest().surfaces[1], file: 'index.html' }] }],
    ['case-insensitive duplicate files', { surfaces: [manifest().surfaces[0], { ...manifest().surfaces[1], file: 'INDEX.HTML' }] }],
    ['duplicate state ids', { surfaces: [{ ...manifest().surfaces[0], states: [
      { id: 'empty', label: 'Empty', required: true },
      { id: 'empty', label: 'Empty again', required: false },
    ] }] }],
    ['future schemas', { schema: 'open-design.design-manifest.v3' }],
    ['invalid states', { surfaces: [{ ...manifest().surfaces[0], status: 'done' }] }],
    ['invalid form factors', { surfaces: [{ ...manifest().surfaces[0], formFactors: ['billboard'] }] }],
    ['non-index entry surfaces', { surfaces: [{ ...manifest().surfaces[0], file: 'dashboard.html' }] }],
    ['optional entry surfaces', { surfaces: [{ ...manifest().surfaces[0], required: false }] }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => parseDesignManifestV2(manifest(overrides))).toThrow(DesignManifestValidationError);
  });

  it('rebinds a copied manifest to the destination project', () => {
    expect(parseDesignManifestV2(manifest(), { projectId: 'project-2' }).projectId)
      .toBe('project-2');
  });

  it('preserves daemon-derived file presence when parsing an API response', () => {
    const source = manifest({
      surfaces: manifest().surfaces.map((surface) => ({ ...surface, filePresent: true })),
    });
    const parsed = parseDesignManifestV2(source);
    expect(parsed.surfaces.every((surface) => surface.filePresent)).toBe(true);
  });

  it('uses one portable Windows and Unicode identity for committed file presence', () => {
    const source = manifest({
      surfaces: [manifest().surfaces[0], {
        ...manifest().surfaces[1],
        file: 'Screens/Caf\u00e9.html',
      }],
    });

    expect(designManifestPathIdentity('Screens/Cafe\u0301.HTML'))
      .toBe(designManifestPathIdentity('screens/caf\u00e9.html'));
    expect(parseDesignManifestV2(source, {
      projectFiles: ['screens/Cafe\u0301.HTML'],
    }).surfaces[1]?.filePresent).toBe(true);
  });

  it('fails closed on ambiguous portable aliases but lets an exact spelling win', () => {
    const projectFiles = ['SCREENS/BILLING.HTML', 'Screens/Billing.html'];
    expect(parseDesignManifestV2(manifest(), { projectFiles }).surfaces[1]?.filePresent)
      .toBe(false);
    expect(parseDesignManifestV2(manifest({
      surfaces: [manifest().surfaces[0], {
        ...manifest().surfaces[1],
        file: 'SCREENS/BILLING.HTML',
      }],
    }), { projectFiles }).surfaces[1]?.filePresent).toBe(true);
  });
});

describe('parseDesignGenerationTarget', () => {
  it('accepts one to sixty exact unique surface ids', () => {
    expect(parseDesignGenerationTarget({
      manifestRevision: 4,
      surfaceIds: ['dashboard', 'billing'],
    })).toEqual({ manifestRevision: 4, surfaceIds: ['dashboard', 'billing'] });
    const ten = Array.from({ length: 10 }, (_, index) => `screen-${index + 1}`);
    expect(parseDesignGenerationTarget({
      manifestRevision: 1,
      surfaceIds: ten,
    })).toEqual({ manifestRevision: 1, surfaceIds: ten });
  });

  it.each([
    { manifestRevision: 0, surfaceIds: ['dashboard'] },
    { manifestRevision: 1, surfaceIds: [] },
    { manifestRevision: 1, surfaceIds: Array.from({ length: 61 }, (_, index) => `s-${index + 1}`) },
    { manifestRevision: 1, surfaceIds: ['dashboard', 'dashboard'] },
    { manifestRevision: 1, surfaceIds: ['Not Safe'] },
  ])('rejects an invalid bounded target %#', (target) => {
    expect(() => parseDesignGenerationTarget(target)).toThrow(DesignManifestValidationError);
  });
});
