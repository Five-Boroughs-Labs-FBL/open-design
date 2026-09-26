import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../src/styles/amc-embed.css', import.meta.url),
  'utf8',
);
const projectView = readFileSync(
  new URL('../../src/components/ProjectView.tsx', import.meta.url),
  'utf8',
);

describe('ACP mobile Design Studio', () => {
  it('keeps Preview and Chat as explicit panes in the ACP embed', () => {
    expect(projectView).toContain('acp-mobile-studio-tabs');
    expect(projectView).toContain("setAcpMobilePane('preview')");
    expect(projectView).toContain("setAcpMobilePane('chat')");
    expect(projectView).toContain("window.matchMedia('(max-width: 640px)')");
  });

  it('uses a single workspace column on phone-sized ACP embeds', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/split-acp-mobile--preview[\s\S]*?--project-chat-panel-width:\s*0px/);
    expect(css).toMatch(/split-acp-mobile--chat[\s\S]*?--project-chat-panel-width:\s*100vw/);
    expect(css).toMatch(/split-acp-mobile--chat[\s\S]*?\.workspace[\s\S]*?visibility:\s*hidden/);
  });
});
