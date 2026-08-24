import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  DESIGN_MANIFEST_FILENAME,
  DESIGN_MANIFEST_MAX_BYTES,
  DESIGN_MANIFEST_MAX_SURFACES,
  designManifestPathIdentity,
  DesignManifestValidationError,
  parseDesignManifestV2,
  type DesignManifestV2,
} from '@open-design/contracts';

export class DesignManifestNotFoundError extends Error {
  readonly code = 'DESIGN_MANIFEST_NOT_FOUND';

  constructor() {
    super('design manifest not found');
    this.name = 'DesignManifestNotFoundError';
  }
}

export class DesignManifestRevisionConflictError extends Error {
  readonly code = 'DESIGN_MANIFEST_REVISION_CONFLICT';

  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(`expected revision ${expectedRevision}, current revision is ${currentRevision}`);
    this.name = 'DesignManifestRevisionConflictError';
  }
}

export class DesignManifestWriterConflictError extends Error {
  readonly code = 'DESIGN_MANIFEST_WRITER_CONFLICT';

  constructor(readonly surfaceIds: string[]) {
    super(`design generation is already in progress for: ${surfaceIds.join(', ')}`);
    this.name = 'DesignManifestWriterConflictError';
  }
}

export interface DesignManifestProjectFile {
  name: string;
  path?: string;
}

export interface DesignManifestStoreDeps {
  projectsRoot: string;
  /** Daemon-private authority. The project file is a portable projection and
   *  must never be trusted as the live writer-lock source. */
  authorityRoot?: string;
  resolveProjectDir: (
    projectsRoot: string,
    projectId: string,
    metadata?: unknown,
  ) => string;
  ensureProject: (
    projectsRoot: string,
    projectId: string,
    metadata?: unknown,
  ) => Promise<string>;
  listFiles: (
    projectsRoot: string,
    projectId: string,
    options?: { metadata?: unknown },
  ) => Promise<DesignManifestProjectFile[]>;
  /** Optional lifecycle fence. Production stores use the project registry so
   * detached reconciliation cannot recreate state after project deletion. */
  projectExists?: (projectId: string) => boolean;
}

export interface DesignManifestStoreProject {
  id: string;
  metadata?: unknown;
}

export interface PutDesignManifestOptions {
  expectedRevision: number;
  manifest: unknown;
}

export interface ClaimDesignManifestSurfacesOptions {
  expectedRevision: number;
  surfaceIds: string[];
  runId: string;
  updatedAt: string;
}

export interface FinishDesignManifestSurfacesOptions {
  surfaceIds: string[];
  completedSurfaceIds: string[];
  runId: string;
  updatedAt: string;
}

export interface DesignManifestStore {
  get(project: DesignManifestStoreProject): Promise<DesignManifestV2>;
  put(
    project: DesignManifestStoreProject,
    options: PutDesignManifestOptions,
  ): Promise<DesignManifestV2>;
  claim(
    project: DesignManifestStoreProject,
    options: ClaimDesignManifestSurfacesOptions,
  ): Promise<DesignManifestV2>;
  finishClaim(
    project: DesignManifestStoreProject,
    options: FinishDesignManifestSurfacesOptions,
  ): Promise<DesignManifestV2>;
  recoverStaleClaims(
    project: DesignManifestStoreProject,
    options: {
      runState: (runId: string) => {
        active: boolean;
        succeeded: boolean;
        exactOutputValidated: boolean;
        artifactPaths?: string[];
      } | null;
      updatedAt: string;
    },
  ): Promise<DesignManifestV2>;
  deleteProjectState(project: DesignManifestStoreProject): Promise<void>;
}

const manifestQueues = new Map<string, Promise<void>>();

async function withManifestLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = manifestQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.then(() => current);
  manifestQueues.set(key, queued);
  await prior;
  try {
    return await task();
  } finally {
    release();
    if (manifestQueues.get(key) === queued) manifestQueues.delete(key);
  }
}

async function readBoundedJson(filePath: string): Promise<unknown> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DesignManifestNotFoundError();
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new DesignManifestValidationError(['manifest path is not a file']);
  }
  if (fileStat.size > DESIGN_MANIFEST_MAX_BYTES) {
    throw new DesignManifestValidationError([
      `manifest exceeds ${DESIGN_MANIFEST_MAX_BYTES} bytes`,
    ]);
  }
  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new DesignManifestValidationError(['manifest is not valid JSON']);
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents, 'utf8') > DESIGN_MANIFEST_MAX_BYTES) {
    throw new DesignManifestValidationError([
      `normalized manifest exceeds ${DESIGN_MANIFEST_MAX_BYTES} bytes`,
    ]);
  }
  const handle = await open(tmpPath, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

function declarativeManifest(manifest: DesignManifestV2): unknown {
  return {
    schema: manifest.schema,
    revision: manifest.revision,
    projectId: manifest.projectId,
    entrySurfaceId: manifest.entrySurfaceId,
    scope: manifest.scope,
    directionStatus: manifest.directionStatus,
    surfaces: manifest.surfaces.map(({ filePresent: _filePresent, ...surface }) => surface),
  };
}

export function createDesignManifestStore(
  deps: DesignManifestStoreDeps,
): DesignManifestStore {
  async function projectFiles(project: DesignManifestStoreProject): Promise<string[]> {
    const files = await deps.listFiles(deps.projectsRoot, project.id, {
      metadata: project.metadata,
    });
    return files.map((file) => file.path || file.name);
  }

  function manifestPath(project: DesignManifestStoreProject): string {
    return path.join(
      deps.resolveProjectDir(deps.projectsRoot, project.id, project.metadata),
      DESIGN_MANIFEST_FILENAME,
    );
  }

  function authorityPath(project: DesignManifestStoreProject): string {
    return path.join(
      deps.authorityRoot ?? path.join(deps.projectsRoot, '.design-manifest-authority'),
      `${project.id}.json`,
    );
  }

  function ownsProjectFiles(project: DesignManifestStoreProject): boolean {
    // Imported-folder projects deliberately keep their user-owned directory
    // when the Open Design record is deleted. Match that lifecycle boundary:
    // private authority is always ours, but the public projection is removed
    // only from the daemon-managed project directory.
    return path.resolve(
      deps.resolveProjectDir(deps.projectsRoot, project.id, project.metadata),
    ) === path.resolve(deps.projectsRoot, project.id);
  }

  function assertProjectExists(project: DesignManifestStoreProject): void {
    if (deps.projectExists && !deps.projectExists(project.id)) {
      throw new DesignManifestNotFoundError();
    }
  }

  async function read(project: DesignManifestStoreProject): Promise<DesignManifestV2> {
    // Never bootstrap live control state from the ordinary project file. Any
    // project writer can edit that portable projection, so trusting it when
    // private authority is absent would let a model forge revisions, claims,
    // and completion. Durable v2 state is created only by sanctioned PUTs (or
    // an explicit project-duplication copy through the store API).
    const value = await readBoundedJson(authorityPath(project));
    const normalized = parseDesignManifestV2(value, {
      projectId: project.id,
      projectFiles: await projectFiles(project),
    });
    // The ordinary project file is inspectable/exportable but not trusted.
    // Repair direct generic/agent edits on the next authoritative read so
    // exports do not stay stale even though Canvas was already safe.
    const projection = declarativeManifest(normalized);
    let publicValue: unknown = null;
    try {
      publicValue = await readBoundedJson(manifestPath(project));
    } catch {
      // Missing, malformed, oversized, or replaced paths are repaired below.
    }
    if (JSON.stringify(publicValue) !== JSON.stringify(projection)) {
      await writeJsonAtomic(manifestPath(project), projection).catch(() => undefined);
    }
    return normalized;
  }

  async function persistNext(
    project: DesignManifestStoreProject,
    filePath: string,
    manifest: DesignManifestV2,
  ): Promise<DesignManifestV2> {
    const normalized = parseDesignManifestV2(manifest, {
      projectId: project.id,
      projectFiles: await projectFiles(project),
    });
    const projection = declarativeManifest(normalized);
    // Commit authority first. A public-projection failure can be repaired by
    // the next sanctioned mutation without losing the writer lock/status.
    await writeJsonAtomic(authorityPath(project), projection);
    // The projection is non-authoritative and GET repairs it best-effort. Do
    // not report a failed mutation after the authority revision committed.
    await writeJsonAtomic(filePath, projection).catch(() => undefined);
    return normalized;
  }

  return {
    get(project) {
      return withManifestLock(authorityPath(project), async () => {
        assertProjectExists(project);
        return read(project);
      });
    },
    async put(project, options) {
      if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) {
        throw new DesignManifestValidationError([
          'expectedRevision must be a non-negative integer',
        ]);
      }
      const filePath = manifestPath(project);
      return withManifestLock(authorityPath(project), async () => {
        assertProjectExists(project);
        await deps.ensureProject(deps.projectsRoot, project.id, project.metadata);
        let currentRevision = 0;
        try {
          const current = await read(project);
          const generating = current.surfaces
            .filter((surface) => surface.status === 'generating')
            .map((surface) => surface.id);
          if (generating.length > 0) throw new DesignManifestWriterConflictError(generating);
          currentRevision = current.revision;
        } catch (error) {
          if (!(error instanceof DesignManifestNotFoundError)) throw error;
        }
        if (currentRevision !== options.expectedRevision) {
          throw new DesignManifestRevisionConflictError(
            options.expectedRevision,
            currentRevision,
          );
        }
        const manifest = parseDesignManifestV2(options.manifest, {
          projectId: project.id,
          projectFiles: await projectFiles(project),
        });
        const forgedClaims = manifest.surfaces
          .filter((surface) => surface.status === 'generating')
          .map((surface) => surface.id);
        if (forgedClaims.length > 0) {
          throw new DesignManifestValidationError([
            `public manifest writes cannot set generating state: ${forgedClaims.join(', ')}`,
          ]);
        }
        if (manifest.revision !== currentRevision + 1) {
          throw new DesignManifestValidationError([
            `manifest.revision must be ${currentRevision + 1}`,
          ]);
        }
        // Persist only declarative state. File presence and coverage can change
        // when an agent edits/deletes files outside HTTP, so every GET derives
        // those fields from the current inventory instead of trusting disk.
        return persistNext(project, filePath, manifest);
      });
    },
    async claim(project, options) {
      if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 1) {
        throw new DesignManifestValidationError([
          'expectedRevision must be a positive integer',
        ]);
      }
      if (!options.runId || !options.updatedAt || options.surfaceIds.length < 1 || options.surfaceIds.length > DESIGN_MANIFEST_MAX_SURFACES) {
        throw new DesignManifestValidationError(['invalid design generation claim']);
      }
      const filePath = manifestPath(project);
      return withManifestLock(authorityPath(project), async () => {
        assertProjectExists(project);
        const current = await read(project);
        if (current.revision !== options.expectedRevision) {
          throw new DesignManifestRevisionConflictError(
            options.expectedRevision,
            current.revision,
          );
        }
        if (current.directionStatus !== 'locked') {
          throw new DesignManifestValidationError([
            'design manifest directionStatus must be locked before generation',
          ]);
        }
        const generating = current.surfaces
          .filter((surface) => surface.status === 'generating')
          .map((surface) => surface.id);
        if (generating.length > 0) throw new DesignManifestWriterConflictError(generating);
        const targets = new Set(options.surfaceIds);
        if (targets.size !== options.surfaceIds.length) {
          throw new DesignManifestValidationError(['surfaceIds must be unique']);
        }
        const byId = new Map(current.surfaces.map((surface) => [surface.id, surface]));
        const missing = options.surfaceIds.filter((id) => !byId.has(id));
        if (missing.length > 0) {
          throw new DesignManifestValidationError([
            `unknown design surface ids: ${missing.join(', ')}`,
          ]);
        }
        const unavailable = options.surfaceIds.filter((id) => {
          const status = byId.get(id)?.status;
          const surface = byId.get(id);
          return status !== 'queued'
            && status !== 'failed'
            && !(status === 'complete' && surface?.filePresent === false);
        });
        if (unavailable.length > 0) {
          throw new DesignManifestValidationError([
            `design surfaces are not queued, failed, or missing-complete: ${unavailable.join(', ')}`,
          ]);
        }
        return persistNext(project, filePath, {
          ...current,
          revision: current.revision + 1,
          surfaces: current.surfaces.map((surface) => targets.has(surface.id)
            ? {
                ...surface,
                status: 'generating' as const,
                latestRunId: options.runId,
                updatedAt: options.updatedAt,
              }
            : surface),
        });
      });
    },
    async finishClaim(project, options) {
      const filePath = manifestPath(project);
      return withManifestLock(authorityPath(project), async () => {
        assertProjectExists(project);
        const current = await read(project);
        const claimed = new Set(options.surfaceIds);
        const completed = new Set(options.completedSurfaceIds);
        const owned = current.surfaces.filter(
          (surface) => claimed.has(surface.id)
            && surface.status === 'generating'
            && surface.latestRunId === options.runId,
        );
        if (owned.length === 0) return current;
        return persistNext(project, filePath, {
          ...current,
          revision: current.revision + 1,
          surfaces: current.surfaces.map((surface) => (
            claimed.has(surface.id)
            && surface.status === 'generating'
            && surface.latestRunId === options.runId
              ? {
                  ...surface,
                  status: completed.has(surface.id) ? 'complete' as const : 'failed' as const,
                  updatedAt: options.updatedAt,
                }
              : surface
          )),
        });
      });
    },
    async recoverStaleClaims(project, options) {
      const filePath = manifestPath(project);
      return withManifestLock(authorityPath(project), async () => {
        assertProjectExists(project);
        const current = await read(project);
        const runStates = new Map<string, ReturnType<typeof options.runState>>();
        const stateFor = (runId: string | null) => {
          if (!runId) return null;
          if (!runStates.has(runId)) runStates.set(runId, options.runState(runId));
          return runStates.get(runId) ?? null;
        };
        const stale = current.surfaces.filter((surface) => {
          if (surface.status !== 'generating') return false;
          return stateFor(surface.latestRunId)?.active !== true;
        });
        if (stale.length === 0) return current;
        const staleIds = new Set(stale.map((surface) => surface.id));
        return persistNext(project, filePath, {
          ...current,
          revision: current.revision + 1,
          surfaces: current.surfaces.map((surface) => {
            if (!staleIds.has(surface.id)) return surface;
            const runState = stateFor(surface.latestRunId);
            const touched = new Set(
              (runState?.artifactPaths ?? []).map(designManifestPathIdentity),
            );
            const completed = surface.filePresent
              && touched.has(designManifestPathIdentity(surface.file));
            return {
              ...surface,
              status: completed ? 'complete' as const : 'failed' as const,
              updatedAt: options.updatedAt,
            };
          }),
        });
      });
    },
    async deleteProjectState(project) {
      await withManifestLock(authorityPath(project), async () => {
        const files = [authorityPath(project)];
        if (ownsProjectFiles(project)) files.push(manifestPath(project));
        for (const filePath of files) {
          await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      });
    },
  };
}
