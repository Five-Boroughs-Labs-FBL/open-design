import type { Express, NextFunction, Request, Response } from 'express';
import { apiTokenAuthorizationMatches } from '../api-token-auth.js';
import { sendAmcEngineDeny } from './deny-page.js';
import {
  grantAllowsProjectApi,
  isProjectListOrCreatePath,
} from './project-api.js';
import { isAmcEngineProfile } from './profile.js';
import { consumeAmcLaunchGrant, mintAmcLaunchGrant, verifyAmcLaunchGrant } from './studio-grant.js';
import {
  createAmcStudioSession,
  readAmcStudioSessionFromRequest,
  revokeAmcStudioSession,
  safeLaunchNext,
  serializeSessionCookie,
} from './studio-session.js';

export type AmcEngineRequest = Request & {
  amcStudioSession?: { sid: string; projectId: string };
  amcOperatorToken?: boolean;
};

function sendJsonError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function registerAmcEngineRoutes(app: Express, options: { apiToken: string }): void {
  const apiToken = String(options.apiToken || '').trim();

  app.post('/api/embed-grants', (_req, res) => {
    sendJsonError(res, 404, 'NOT_FOUND', 'catalog grants are not available');
  });

  app.get('/amc/launch', (req, res) => {
    const grant = String(req.query.g || req.query.grant || '').trim();
    const verified = verifyAmcLaunchGrant(grant);
    if (!verified.ok) {
      sendAmcEngineDeny(res);
      return;
    }
    if (!consumeAmcLaunchGrant(verified)) {
      sendAmcEngineDeny(res);
      return;
    }
    const nextPath = safeLaunchNext(String(req.query.next || ''), verified.projectId);
    if (!nextPath) {
      sendAmcEngineDeny(res);
      return;
    }
    const session = createAmcStudioSession(verified.projectId);
    res.setHeader('Set-Cookie', serializeSessionCookie(req, session));
    res.redirect(302, nextPath);
  });

  app.post('/api/projects/:id/embed-grants', (req: AmcEngineRequest, res) => {
    if (!req.amcOperatorToken && !apiTokenAuthorizationMatches(req.get('authorization'), apiToken)) {
      sendJsonError(res, 401, 'API_TOKEN_REQUIRED', 'operator Bearer required');
      return;
    }
    const projectId = String(req.params.id || '').trim();
    const userId = String(req.body?.userId || '').trim();
    if (!projectId || !userId) {
      sendJsonError(res, 400, 'BAD_REQUEST', 'projectId and userId required');
      return;
    }
    try {
      const minted = mintAmcLaunchGrant({
        projectId,
        userId,
        ttlSec: req.body?.ttlSec,
      });
      res.status(201).json({
        token: minted.token,
        expiresAt: minted.expiresAt,
        projectId: minted.projectId,
        userId: minted.userId,
      });
    } catch (err) {
      sendJsonError(res, 503, 'AMC_GRANT_UNAVAILABLE', err instanceof Error ? err.message : String(err));
    }
  });

  app.post('/api/projects/:id/amc-session/revoke', (req: AmcEngineRequest, res) => {
    if (!req.amcOperatorToken && !apiTokenAuthorizationMatches(req.get('authorization'), apiToken)) {
      sendJsonError(res, 401, 'API_TOKEN_REQUIRED', 'operator Bearer required');
      return;
    }
    const projectId = String(req.params.id || '').trim();
    const n = revokeAmcStudioSession(projectId, String(req.body?.sid || '').trim() || undefined);
    res.json({ ok: true, revoked: n });
  });
}

export function amcEngineApiAuth(options: {
  apiToken: string;
  isOperatorAuthorization: (authorization: string | undefined) => boolean;
}) {
  return (req: AmcEngineRequest, res: Response, next: NextFunction): void => {
    if (!isAmcEngineProfile()) return next();
    const open = req.path === '/health' || req.path === '/ready' || req.path === '/version';
    if (open) return next();
    if (options.isOperatorAuthorization(req.get('authorization'))) {
      req.amcOperatorToken = true;
      return next();
    }
    if (req.path.endsWith('/embed-grants') && req.method === 'POST') {
      return next();
    }
    if (req.path.endsWith('/amc-session/revoke') && req.method === 'POST') {
      return next();
    }

    const session = readAmcStudioSessionFromRequest(req);
    if (isProjectListOrCreatePath(req)) {
      sendJsonError(res, 401, 'AMC_STUDIO_REQUIRED', 'project list is not available');
      return;
    }
    const allows = session && grantAllowsProjectApi(req, session.projectId);
    if (!allows) {
      sendJsonError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      return;
    }
    req.amcStudioSession = { sid: session.sid, projectId: session.projectId };
    next();
  };
}
