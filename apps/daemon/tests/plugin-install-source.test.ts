import { describe, expect, it } from 'vitest';

import { isLocalPluginInstallSource } from '../src/plugins/install-source.js';

describe('isLocalPluginInstallSource', () => {
  it('accepts POSIX, home, relative, and Windows drive paths', () => {
    expect(isLocalPluginInstallSource('/tmp/plugin')).toBe(true);
    expect(isLocalPluginInstallSource('./plugin')).toBe(true);
    expect(isLocalPluginInstallSource('../plugin')).toBe(true);
    expect(isLocalPluginInstallSource('~/plugin')).toBe(true);
    expect(isLocalPluginInstallSource('C:\\Users\\me\\plugin')).toBe(true);
    expect(isLocalPluginInstallSource('C:/Users/me/plugin')).toBe(true);
  });

  it('rejects marketplace names and remote refs', () => {
    expect(isLocalPluginInstallSource('sample-plugin')).toBe(false);
    expect(isLocalPluginInstallSource('github:nexu-io/open-design')).toBe(false);
    expect(isLocalPluginInstallSource('https://example.com/plugin.tgz')).toBe(false);
  });
});
