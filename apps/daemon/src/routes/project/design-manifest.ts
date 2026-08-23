import type { Express, Request, Response } from 'express';
import {
  DesignManifestValidationError,
  type PutDesignManifestRequest,
} from '@open-design/contracts';
import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import {
  DesignManifestNotFoundError,
  DesignManifestRevisionConflictError,
  DesignManifestWriterConflictError,
  type DesignManifestStore,
  type DesignManifestStoreProject,
} from '../../storage/design-manifest.js';

export interface RegisterDesignManifestRoutesDeps {
  getProject: (projectId: string) => DesignManifestStoreProject | null | undefined;
  authorizeProjectRequest: AuthorizeProjectRequest;
  sendApiError: (
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) => unknown;
  store: DesignManifestStore;
  recoverStaleClaims?: (project: DesignManifestStoreProject) => Promise<void>;
  emitInvalidation?: (projectId: string) => void;
}

function sendManifestError(
  error: unknown,
  res: Response,
  sendApiError: RegisterDesignManifestRoutesDeps['sendApiError'],
): unknown {
  if (error instanceof DesignManifestNotFoundError) {
    return sendApiError(res, 404, error.code, error.message);
  }
  if (error instanceof DesignManifestRevisionConflictError) {
    return sendApiError(res, 409, error.code, error.message, {
      expectedRevision: error.expectedRevision,
      currentRevision: error.currentRevision,
    });
  }
  if (error instanceof DesignManifestWriterConflictError) {
    return sendApiError(res, 409, error.code, error.message, {
      surfaceIds: error.surfaceIds,
    });
  }
  if (error instanceof DesignManifestValidationError) {
    return sendApiError(res, 422, error.code, error.message, { issues: error.issues });
  }
  return sendApiError(
    res,
    500,
    'DESIGN_MANIFEST_STORE_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}

export function registerDesignManifestRoutes(
  app: Express,
  deps: RegisterDesignManifestRoutesDeps,
): void {
  async function projectFor(
    req: Request,
    res: Response,
    mode: 'read' | 'write',
  ): Promise<DesignManifestStoreProject | null> {
    const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!projectId) {
      deps.sendApiError(res, 400, 'BAD_REQUEST', 'project id is required');
      return null;
    }
    const project = deps.getProject(projectId);
    if (!project) {
      deps.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return null;
    }
    const allowed = await deps.authorizeProjectRequest(
      req,
      res,
      project.id,
      mode === 'read' ? { mode } : { mode, capability: 'writeFiles' },
    );
    return allowed ? project : null;
  }

  app.get('/api/projects/:id/design-manifest', async (req, res) => {
    const project = await projectFor(req, res, 'read');
    if (!project) return;
    try {
      await deps.recoverStaleClaims?.(project);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ manifest: await deps.store.get(project) });
    } catch (error) {
      sendManifestError(error, res, deps.sendApiError);
    }
  });

  app.put('/api/projects/:id/design-manifest', async (req, res) => {
    const project = await projectFor(req, res, 'write');
    if (!project) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Partial<PutDesignManifestRequest>;
    try {
      await deps.recoverStaleClaims?.(project);
      const manifest = await deps.store.put(project, {
        expectedRevision: body.expectedRevision as number,
        manifest: body.manifest,
      });
      deps.emitInvalidation?.(project.id);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ manifest });
    } catch (error) {
      sendManifestError(error, res, deps.sendApiError);
    }
  });
}
