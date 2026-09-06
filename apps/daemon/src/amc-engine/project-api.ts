export type ParsedProjectApiPath = {
  projectId: string;
  rest: string;
};

/** Express `req.path` when the middleware is mounted at `/api`. */
export function parseProjectApiPath(apiPath: string): ParsedProjectApiPath | null {
  const raw = String(apiPath || '');
  const match = /^\/projects\/([^/]+)(\/.*)?$/.exec(raw);
  if (!match) return null;
  try {
    return {
      projectId: decodeURIComponent(match[1] || ''),
      rest: match[2] || '',
    };
  } catch {
    return null;
  }
}

export function parseProjectHtmlPath(pathname: string): { projectId: string; rest: string } | null {
  const raw = String(pathname || '');
  const match = /^\/projects\/([^/]+)(\/.*)?$/.exec(raw);
  if (!match) return null;
  try {
    return {
      projectId: decodeURIComponent(match[1] || ''),
      rest: match[2] || '',
    };
  } catch {
    return null;
  }
}

const DENIED_PROJECT_RESTS = new Set([
  '/duplicate',
  '/design-system-copy',
]);

export function grantAllowsProjectApi(
  req: { method: string; path: string },
  projectId: string,
): boolean {
  const parsed = parseProjectApiPath(req.path);
  if (!parsed || parsed.projectId !== projectId) return false;
  if (req.method === 'DELETE' && parsed.rest === '') return false;
  if (DENIED_PROJECT_RESTS.has(parsed.rest)) return false;
  return true;
}

export function isProjectListOrCreatePath(req: { method: string; path: string }): boolean {
  return req.path === '/projects' || req.path === '/projects/';
}
