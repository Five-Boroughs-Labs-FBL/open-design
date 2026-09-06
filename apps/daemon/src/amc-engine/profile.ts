import { isTruthyEnvFlag } from '../api-token-auth.js';

export const AMC_ENGINE_PROFILE = 'amc-engine';

export function isAmcEngineProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.OD_DEPLOYMENT_PROFILE || env.OD_HOST_MODE || '').trim().toLowerCase();
  if (raw === AMC_ENGINE_PROFILE || raw === 'amc') return true;
  return isTruthyEnvFlag(env.OD_AMC_ENGINE);
}

export function amcEngineStudioSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.OD_AMC_STUDIO_SECRET || env.OD_API_TOKEN || '').trim();
}
