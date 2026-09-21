import { describe, expect, it } from 'vitest';

import {
  buildSocialSharePayload,
  OPEN_DESIGN_GITHUB_REPO_URL,
} from '../src/api/social-share';

describe('social-share contract', () => {
  it('uses ACP Design when share title and text are omitted', () => {
    const payload = buildSocialSharePayload({ kind: 'open-design-repo' });
    expect(payload.title).toBe('ACP Design');
    expect(payload.text).toBe(
      'ACP Design is an open-source workspace for creating, editing, deploying, and handing off design artifacts.',
    );

    const project = buildSocialSharePayload({
      kind: 'project-html',
      url: 'https://example.com/demo',
    });
    expect(project.title).toBe('ACP Design project');
    expect(project.text).toBe(
      `Built with ACP Design: ACP Design project. ACP Design repo: ${OPEN_DESIGN_GITHUB_REPO_URL}`,
    );
  });

  it('builds repository share targets from the caller-supplied title and text', () => {
    const payload = buildSocialSharePayload({
      kind: 'open-design-repo',
      locale: 'zh-CN',
      title: 'OpenDesign GitHub',
      text: '推荐 OpenDesign',
    });

    expect(payload.url).toBe(OPEN_DESIGN_GITHUB_REPO_URL);
    expect(payload.locale).toBe('zh-CN');
    expect(payload.platforms.some((target) => target.platform === 'x' && target.shareUrl?.includes('twitter.com/intent/tweet'))).toBe(true);
    expect(payload.platforms.some((target) => target.platform === 'xiaohongshu' && target.mode === 'copy-open')).toBe(true);
  });

  it('keeps deployed project links and the repo recommendation together', () => {
    const payload = buildSocialSharePayload({
      kind: 'project-html',
      locale: 'en',
      url: 'https://example.com/open-design-demo',
      title: 'Demo',
      text: `Built with OpenDesign. Repo: ${OPEN_DESIGN_GITHUB_REPO_URL}`,
      copyText: `Demo\nhttps://example.com/open-design-demo\n${OPEN_DESIGN_GITHUB_REPO_URL}`,
    });

    expect(payload.url).toBe('https://example.com/open-design-demo');
    expect(payload.githubRepoUrl).toBe(OPEN_DESIGN_GITHUB_REPO_URL);
    expect(payload.copyText).toContain(OPEN_DESIGN_GITHUB_REPO_URL);
    expect(payload.platforms.find((target) => target.platform === 'telegram')?.shareUrl)
      .toContain('https%3A%2F%2Fexample.com%2Fopen-design-demo');
  });
});
