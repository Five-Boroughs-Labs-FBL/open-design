import type { NextFunction, Request, Response } from 'express';
import { isStaticSpaFallbackRequest } from '../static-spa.js';
import { sendAmcEngineDeny } from './deny-page.js';
import { parseProjectHtmlPath } from './project-api.js';
import { isAmcEngineProfile } from './profile.js';
import { readAmcStudioSessionFromRequest } from './studio-session.js';

export function isAmcEngineLaunchPath(pathname: string): boolean {
  return pathname === '/amc/launch';
}

export function amcEngineHtmlGate(req: Request, res: Response, next: NextFunction): void {
  if (!isAmcEngineProfile()) return next();
  if (!isStaticSpaFallbackRequest(req)) return next();
  if (isAmcEngineLaunchPath(req.path)) return next();

  const project = parseProjectHtmlPath(req.path);
  if (!project) {
    sendAmcEngineDeny(res);
    return;
  }
  const session = readAmcStudioSessionFromRequest(req);
  if (!session || session.projectId !== project.projectId) {
    sendAmcEngineDeny(res);
    return;
  }
  next();
}
