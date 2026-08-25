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
  it('forbids Write of the open live primary and requires a re-streamed artifact', () => {
    const text = renderDesignGenerationDirective(
      manifest([
        { id: 'login', file: 'index.html' },
        { id: 'dashboard', file: 'dashboard.html' },
      ]),
      { surfaceIds: ['login'], manifestRevision: 2 },
    );
    expect(text).toContain('Never Write, Edit, or overwrite that open live file');
    expect(text).toContain('re-stream exactly one complete HTML document');
    expect(text).toContain('<artifact identifier="login" type="text/html">');
    expect(text).not.toContain('or write it directly to its exact declared file');
  });
});
