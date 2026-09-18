import { describe, expect, it } from 'vitest';

import {
  PLUGIN_SHARE_ACTION_LABELS,
  renderPluginSharePrompt,
} from '../src/plugins/share-helpers.js';

describe('plugin share copy', () => {
  it('names ACP Design in contribute labels and prompts', () => {
    expect(PLUGIN_SHARE_ACTION_LABELS['contribute-open-design']).toBe('Contribute to ACP Design');
    expect(PLUGIN_SHARE_ACTION_LABELS['contribute-open-design']).not.toContain('OpenDesign');

    const prompt = renderPluginSharePrompt({
      action: 'contribute-open-design',
      sourcePlugin: { id: 'sample', title: 'Sample' },
      stagedPath: 'plugin-source/sample',
    });
    expect(prompt).toContain('local ACP Design plugin');
    expect(prompt).toContain('ACP Design repository');
    expect(prompt).not.toContain('OpenDesign');
  });
});
