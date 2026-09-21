import path from 'node:path';

/**
 * Local plugin install sources the daemon copies from disk.
 * Marketplace names, github: refs, and https:// archives are not local.
 * Windows drive paths (`C:\…`) must count as local — `startsWith('/')` misses them.
 */
export function isLocalPluginInstallSource(source: string): boolean {
  const value = source.trim();
  if (!value) return false;
  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('~')) return true;
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}
