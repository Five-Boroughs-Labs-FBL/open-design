import { describe, expect, it } from 'vitest';

import { renderOAuthResultPage } from '../src/http/oauth-result-page.js';

describe('renderOAuthResultPage', () => {
  it('names ACP Design in the success page the user sees after MCP OAuth', () => {
    const html = renderOAuthResultPage({ ok: true, serverId: 'github' });
    expect(html).toContain('<title>Connected — ACP Design</title>');
    expect(html).toContain('return to ACP Design.');
    expect(html).not.toContain('OpenDesign');
    expect(html).not.toContain('Open Design');
  });
});
