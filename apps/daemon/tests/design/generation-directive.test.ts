import { describe, expect, it } from 'vitest';
import type { DesignManifestV2 } from '@open-design/contracts';
import { DESIGN_MANIFEST_V2_SCHEMA } from '@open-design/contracts';

import { renderDesignGenerationDirective } from '../../src/design/generation-directive.js';

function manifest(files: Array<{ id: string; file: string }>): DesignManifestV2 {
  return {
    schema: DESIGN_MANIFEST_V2_SCHEMA,
    revision: 2,
    projectId: 'ops-hud',
    entrySurfaceId: files[0]?.id ?? 'login',
    scope: {
      schema: 'amc.design-scope.v1',
      scopeId: 'dscope_01',
      revision: 1,
      intentDigest: 'sha256:test',
    },
    directionStatus: 'locked',
    surfaces: files.map((surface, index) => ({
      id: surface.id,
      title: surface.id,
      purpose: surface.id,
      priority: index === 0 ? 'primary' : 'required',
      kind: 'screen',
      file: surface.file,
      status: 'complete',
      required: true,
      states: [],
      formFactors: ['desktop'],
      latestRunId: null,
      updatedAt: null,
      filePresent: true,
    })),
    coverage: {
      required: files.length,
      complete: files.length,
      failed: 0,
      waived: 0,
      pending: 0,
      missingSurfaceIds: [],
      percent: 100,
      ready: true,
    },
  };
}

describe('renderDesignGenerationDirective', () => {
  it('assigns the primary to the lead and the other nine files to children', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      id: `screen-${i}`, file: i === 0 ? 'index.html' : `screen-${i}.html`,
    }));
    const text = renderDesignGenerationDirective(manifest(files), {
      surfaceIds: files.map((file) => file.id), manifestRevision: 2,
    });
    expect(text).toContain('lead agent owns the first listed surface (`screen-0` → `index.html`)');
    expect(text).toContain('spawn one general-purpose sub-agent');
    expect(text).toContain('exactly one complete HTML document');
    expect(text).toContain('Wait for all assigned files');
    expect(text).not.toContain('re-stream');
    expect(text).not.toContain('open live primary');
  });

  it('edits the exact claimed file on a single-surface change-turn', () => {
    const text = renderDesignGenerationDirective(manifest([
      { id: 'login', file: 'index.html' }, { id: 'dashboard', file: 'dashboard.html' },
    ]), { surfaceIds: ['dashboard'], manifestRevision: 2 });
    expect(text).toContain('lead agent owns the first listed surface (`dashboard` → `dashboard.html`)');
    expect(text).toContain('including on change-turns');
    expect(text).not.toContain('re-stream');
  });
});
