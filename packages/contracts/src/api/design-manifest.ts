import { z } from 'zod';

export const DESIGN_MANIFEST_FILENAME = 'DESIGN-MANIFEST.json' as const;
export const DESIGN_MANIFEST_V2_SCHEMA = 'open-design.design-manifest.v2' as const;
export const DESIGN_MANIFEST_MAX_SURFACES = 60;
export const DESIGN_MANIFEST_MAX_BYTES = 256 * 1024;
export const DESIGN_MANIFEST_MAX_SCOPE_BYTES = 128 * 1024;

export type DesignManifestDirectionStatus = 'draft' | 'locked';
export type DesignManifestSurfaceStatus =
  | 'queued'
  | 'generating'
  | 'complete'
  | 'failed'
  | 'waived';
export type DesignManifestSurfacePriority = 'primary' | 'required' | 'supporting';
export type DesignManifestSurfaceKind = 'screen' | 'overlay' | 'system-state';
export type DesignManifestFormFactor =
  | 'responsive'
  | 'mobile'
  | 'tablet'
  | 'desktop'
  | 'wide'
  | 'tv'
  | 'handheld'
  | 'wearable';

export interface DesignManifestSurfaceState {
  id: string;
  label: string;
  required: boolean;
}

export interface DesignManifestScope {
  schema: string;
  scopeId: string;
  revision: number;
  intentDigest: string;
  [key: string]: unknown;
}

export interface DesignManifestSurface {
  id: string;
  title: string;
  purpose: string;
  priority: DesignManifestSurfacePriority;
  kind: DesignManifestSurfaceKind;
  file: string;
  status: DesignManifestSurfaceStatus;
  required: boolean;
  states: DesignManifestSurfaceState[];
  formFactors: DesignManifestFormFactor[];
  latestRunId: string | null;
  updatedAt: string | null;
  /** Daemon-derived. A caller-supplied value is always ignored. */
  filePresent: boolean;
}

export interface DesignManifestCoverage {
  required: number;
  complete: number;
  failed: number;
  waived: number;
  pending: number;
  missingSurfaceIds: string[];
  percent: number;
  ready: boolean;
}

export interface DesignManifestV2 {
  schema: typeof DESIGN_MANIFEST_V2_SCHEMA;
  revision: number;
  projectId: string;
  entrySurfaceId: string;
  scope: DesignManifestScope;
  directionStatus: DesignManifestDirectionStatus;
  surfaces: DesignManifestSurface[];
  /** Daemon-derived. A caller-supplied value is always ignored. */
  coverage: DesignManifestCoverage;
}

/** A bounded progressive-generation claim against one durable manifest revision. */
export interface DesignGenerationTarget {
  manifestRevision: number;
  surfaceIds: string[];
}

export interface DesignManifestResponse {
  manifest: DesignManifestV2;
}

export interface PutDesignManifestRequest {
  expectedRevision: number;
  manifest: unknown;
}

export type PutDesignManifestResponse = DesignManifestResponse;

export class DesignManifestValidationError extends Error {
  readonly code = 'DESIGN_MANIFEST_INVALID';
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'DesignManifestValidationError';
    this.issues = issues;
  }
}

/** Portable identity for manifest-owned relative paths. Never use this value
 * for filesystem I/O; resolve it back to the one actual listed project path. */
export function designManifestPathIdentity(value: string): string {
  return value.replaceAll('\\', '/').normalize('NFC').toLowerCase();
}

const identifierSchema = z.string().trim().min(1).max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'must be lower kebab-case');
const boundedLabelSchema = z.string().trim().min(1).max(160);
const nullableIdSchema = z.string().trim().min(1).max(160).nullable().default(null);
const nullableIsoSchema = z.string().datetime({ offset: true }).nullable().default(null);

const scopeSchema = z.object({
  schema: z.string().trim().min(1).max(96),
  scopeId: z.string().trim().min(1).max(160),
  revision: z.number().int().positive(),
  intentDigest: z.string().trim().min(1).max(256),
}).passthrough();

const surfaceStateSchema = z.object({
  id: identifierSchema,
  label: boundedLabelSchema,
  required: z.boolean(),
}).strict();

const surfaceSchema = z.object({
  id: identifierSchema,
  title: boundedLabelSchema,
  purpose: z.string().trim().max(500).default(''),
  priority: z.enum(['primary', 'required', 'supporting']).default('required'),
  kind: z.enum(['screen', 'overlay', 'system-state']).default('screen'),
  file: z.string().trim().min(1).max(240),
  status: z.enum(['queued', 'generating', 'complete', 'failed', 'waived']),
  required: z.boolean(),
  states: z.array(surfaceStateSchema).max(40).default([]),
  formFactors: z.array(z.enum([
    'responsive',
    'mobile',
    'tablet',
    'desktop',
    'wide',
    'tv',
    'handheld',
    'wearable',
  ])).max(8).default([]),
  latestRunId: nullableIdSchema,
  updatedAt: nullableIsoSchema,
  filePresent: z.boolean().optional(),
}).strict();

const manifestSchema = z.object({
  schema: z.literal(DESIGN_MANIFEST_V2_SCHEMA),
  revision: z.number().int().positive(),
  projectId: z.string().trim().min(1).max(160),
  entrySurfaceId: identifierSchema,
  scope: scopeSchema,
  directionStatus: z.enum(['draft', 'locked']),
  surfaces: z.array(surfaceSchema).min(1).max(DESIGN_MANIFEST_MAX_SURFACES),
  coverage: z.unknown().optional(),
}).strict();

const designGenerationTargetSchema = z.object({
  manifestRevision: z.number().int().positive(),
  surfaceIds: z.array(identifierSchema).min(1).max(3),
}).strict();

export function parseDesignGenerationTarget(input: unknown): DesignGenerationTarget {
  const parsed = designGenerationTargetSchema.safeParse(input);
  if (!parsed.success) {
    throw new DesignManifestValidationError(
      parsed.error.issues.map(
        (issue) => `designGeneration.${issue.path.join('.') || 'target'}: ${issue.message}`,
      ),
    );
  }
  if (new Set(parsed.data.surfaceIds).size !== parsed.data.surfaceIds.length) {
    throw new DesignManifestValidationError(['designGeneration.surfaceIds must be unique']);
  }
  return {
    manifestRevision: parsed.data.manifestRevision,
    surfaceIds: [...parsed.data.surfaceIds],
  };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isSafeProjectRelativePath(value: string): boolean {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/')) return false;
  const parts = value.split('/');
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  const windowsForbidden = /[<>:"|?*\u0000-\u001f]/u;
  return parts.every((part) => {
    if (
      !part
      || part.startsWith('.')
      || part.endsWith('.')
      || part.endsWith(' ')
      || windowsForbidden.test(part)
      || windowsReserved.test(part)
    ) return false;
    try {
      const decoded = decodeURIComponent(part);
      return decoded !== '.' && decoded !== '..' && !decoded.startsWith('.');
    } catch {
      return false;
    }
  });
}

export function deriveDesignManifestCoverage(
  surfaces: readonly DesignManifestSurface[],
): DesignManifestCoverage {
  const requiredSurfaces = surfaces.filter((surface) => surface.required);
  const complete = requiredSurfaces.filter(
    (surface) => surface.status === 'complete' && surface.filePresent,
  ).length;
  const failed = requiredSurfaces.filter((surface) => surface.status === 'failed').length;
  const waived = requiredSurfaces.filter((surface) => surface.status === 'waived').length;
  const missingSurfaceIds = requiredSurfaces
    .filter((surface) => surface.status !== 'waived')
    .filter((surface) => surface.status !== 'complete' || !surface.filePresent)
    .map((surface) => surface.id);
  const required = requiredSurfaces.length;
  const pending = Math.max(0, required - complete - failed - waived);
  return {
    required,
    complete,
    failed,
    waived,
    pending,
    missingSurfaceIds,
    percent: required === 0 ? 100 : Math.round(((complete + waived) / required) * 100),
    ready: required === complete + waived,
  };
}

export function parseDesignManifestV2(
  input: unknown,
  options: { projectId?: string; projectFiles?: Iterable<string> } = {},
): DesignManifestV2 {
  if (byteLength(input) > DESIGN_MANIFEST_MAX_BYTES) {
    throw new DesignManifestValidationError([
      `manifest exceeds ${DESIGN_MANIFEST_MAX_BYTES} bytes`,
    ]);
  }
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new DesignManifestValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`),
    );
  }
  const manifest = parsed.data;
  const issues: string[] = [];
  if (byteLength(manifest.scope) > DESIGN_MANIFEST_MAX_SCOPE_BYTES) {
    issues.push(`scope exceeds ${DESIGN_MANIFEST_MAX_SCOPE_BYTES} bytes`);
  }
  const ids = new Set<string>();
  // Manifests are portable across Windows and the default macOS filesystem,
  // where case-only/NFC-only path variants address the same file.
  const files = new Set<string>();
  for (const surface of manifest.surfaces) {
    if (ids.has(surface.id)) issues.push(`duplicate surface id: ${surface.id}`);
    ids.add(surface.id);
    if (!isSafeProjectRelativePath(surface.file)) {
      issues.push(`unsafe surface file path: ${surface.file}`);
    }
    if (!/\.html?$/iu.test(surface.file)) {
      issues.push(`surface file must be HTML: ${surface.file}`);
    }
    if (surface.file === DESIGN_MANIFEST_FILENAME) {
      issues.push(`surface file cannot be ${DESIGN_MANIFEST_FILENAME}`);
    }
    const canonicalFile = designManifestPathIdentity(surface.file);
    if (files.has(canonicalFile)) issues.push(`duplicate surface file: ${surface.file}`);
    files.add(canonicalFile);
    const stateIds = new Set<string>();
    for (const state of surface.states) {
      if (stateIds.has(state.id)) issues.push(`duplicate state id on ${surface.id}: ${state.id}`);
      stateIds.add(state.id);
    }
  }
  if (!ids.has(manifest.entrySurfaceId)) {
    issues.push('entrySurfaceId must reference a surface');
  } else {
    const entrySurface = manifest.surfaces.find((surface) => surface.id === manifest.entrySurfaceId);
    if (entrySurface?.file !== 'index.html') issues.push('the entry surface must use index.html');
    if (entrySurface?.required !== true) issues.push('the entry surface must be required');
  }
  if (issues.length > 0) throw new DesignManifestValidationError(issues);

  const hasProjectFiles = options.projectFiles !== undefined;
  const projectFileSpellings = [...(options.projectFiles ?? [])]
    .map((file) => file.replaceAll('\\', '/').normalize('NFC'));
  const exactProjectFiles = new Set(projectFileSpellings);
  const projectFileIdentityCounts = new Map<string, number>();
  for (const file of projectFileSpellings) {
    const identity = designManifestPathIdentity(file);
    projectFileIdentityCounts.set(identity, (projectFileIdentityCounts.get(identity) ?? 0) + 1);
  }
  const surfaces: DesignManifestSurface[] = manifest.surfaces.map((surface) => ({
    id: surface.id,
    title: surface.title,
    purpose: surface.purpose,
    priority: surface.priority,
    kind: surface.kind,
    file: surface.file,
    status: surface.status,
    required: surface.required,
    states: surface.states,
    formFactors: [...new Set(surface.formFactors)],
    latestRunId: surface.latestRunId,
    updatedAt: surface.updatedAt,
    filePresent: hasProjectFiles
      ? exactProjectFiles.has(surface.file.normalize('NFC'))
        || projectFileIdentityCounts.get(designManifestPathIdentity(surface.file)) === 1
      : (surface.filePresent ?? false),
  }));
  return {
    schema: DESIGN_MANIFEST_V2_SCHEMA,
    revision: manifest.revision,
    // A project duplicate intentionally copies this durable file. The route is
    // the authority for the destination binding, so normalize an inherited id
    // to the requested project instead of making every duplicate invalid.
    projectId: options.projectId ?? manifest.projectId,
    entrySurfaceId: manifest.entrySurfaceId,
    scope: manifest.scope as DesignManifestScope,
    directionStatus: manifest.directionStatus,
    surfaces,
    coverage: deriveDesignManifestCoverage(surfaces),
  };
}
