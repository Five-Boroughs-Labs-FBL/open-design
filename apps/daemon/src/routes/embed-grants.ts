import type { Express, Request, Response } from 'express';
import type {
  ApiError,
  ApiErrorCode,
  CreateProjectEmbedGrantResponse,
} from '@open-design/contracts';

import { apiTokenAuthorizationMatches, apiTokenFromEnv } from '../api-token-auth.js';
import { EMBED_GRANT_TTL_MS, mintEmbedGrant } from '../embed-grants.js';
import { isLoopbackPeerAddress } from '../http/local-daemon-request.js';

const EMBED_GRANT_TTL_SEC_DEFAULT = Math.floor(EMBED_GRANT_TTL_MS / 1000);
const EMBED_GRANT_TTL_SEC_MIN = 60;
const EMBED_GRANT_TTL_SEC_MAX = 86_400;

export interface RegisterEmbedGrantRoutesDeps {
  getProject: (projectId: string) => { id: string } | null | undefined;
  sendApiError: (
    res: Response,
    status: number,
    code: ApiErrorCode,
    message: string,
    init?: Omit<ApiError, 'code' | 'message'>,
  ) => unknown;
}

type EmbedGrantMintRequest = Request;

function projectIdFromRequest(req: Request): string {
  const raw = req.params.id;
  return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
}

function jsonObject(body: unknown): Record<string, unknown> {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function readUserId(body: Record<string, unknown>): string {
  return typeof body.userId === 'string' ? body.userId.trim() : '';
}

function readTtlSec(raw: unknown): { ok: true; value: number } | { ok: false } {
  if (raw == null || raw === '') return { ok: true, value: EMBED_GRANT_TTL_SEC_DEFAULT };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return { ok: false };
  return {
    ok: true,
    value: Math.min(EMBED_GRANT_TTL_SEC_MAX, Math.max(EMBED_GRANT_TTL_SEC_MIN, Math.floor(n))),
  };
}

function authorizeMint(req: EmbedGrantMintRequest): 'ok' | 'forbidden' | 'unauthorized' {
  if (req.embedGrant) return 'forbidden';

  const apiToken = apiTokenFromEnv();
  const authorization = req.get('authorization');
  if (apiToken.length > 0 && apiTokenAuthorizationMatches(authorization, apiToken)) {
    return 'ok';
  }
  // A present Bearer/Basic that is not the server token — including a grant
  // string — must not fall through to the loopback CLI exemption.
  if (typeof authorization === 'string' && authorization.trim().length > 0) {
    return 'unauthorized';
  }
  if (apiToken.length > 0 && isLoopbackPeerAddress(req.socket?.remoteAddress)) {
    return 'ok';
  }
  return 'unauthorized';
}

export function registerEmbedGrantRoutes(app: Express, deps: RegisterEmbedGrantRoutesDeps): void {
  app.post('/api/projects/:id/embed-grants', (req, res) => {
    const decision = authorizeMint(req);
    if (decision === 'forbidden') {
      return deps.sendApiError(
        res,
        403,
        'EMBED_GRANT_SCOPE',
        'embed grant cannot mint embed grants',
      );
    }
    if (decision === 'unauthorized') {
      return deps.sendApiError(
        res,
        401,
        'UNAUTHORIZED',
        'Authorization: Bearer <OD_API_TOKEN> required to mint embed grants',
      );
    }

    const projectId = projectIdFromRequest(req);
    if (!projectId) {
      return deps.sendApiError(res, 400, 'BAD_REQUEST', 'project id is required');
    }
    const project = deps.getProject(projectId);
    if (!project) {
      return deps.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }

    const body = jsonObject(req.body);
    const userId = readUserId(body);
    if (!userId) {
      return deps.sendApiError(res, 400, 'BAD_REQUEST', 'userId is required');
    }
    const ttlSec = readTtlSec(body.ttlSec);
    if (!ttlSec.ok) {
      return deps.sendApiError(res, 400, 'BAD_REQUEST', 'ttlSec must be a number');
    }

    const apiToken = apiTokenFromEnv();
    const minted = mintEmbedGrant(apiToken, {
      projectId: project.id,
      ttlMs: ttlSec.value * 1000,
      userId,
    });
    const payload: CreateProjectEmbedGrantResponse = {
      projectId: project.id,
      userId,
      token: minted.token,
      expiresAt: minted.expiresAt.toISOString(),
    };
    return res.json(payload);
  });
}
