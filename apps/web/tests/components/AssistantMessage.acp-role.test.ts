// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { assistantRoleLabel, assistantRoleName } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

const t = () => 'Assistant';

const runners: ChatMessage[] = [
  {
    id: 'cursor',
    role: 'assistant',
    content: '',
    agentId: 'cursor-agent',
    agentName: 'Cursor · grok-4.6',
    events: [{ kind: 'status', label: 'initializing', detail: 'grok-4.6' }],
  },
  {
    id: 'muse',
    role: 'assistant',
    content: '',
    agentId: 'muse',
    agentName: 'Muse · muse-1',
  },
  {
    id: 'grok',
    role: 'assistant',
    content: '',
    agentId: 'grok-build',
    agentName: 'Grok',
  },
];

describe('ACP Studio chat role', () => {
  afterEach(() => {
    delete document.documentElement.dataset.acpEmbed;
  });

  it('shows ACP agent for every runner and hides the model', () => {
    document.documentElement.dataset.acpEmbed = '1';
    for (const message of runners) {
      expect(assistantRoleName(message, t)).toBe('ACP agent');
      expect(assistantRoleLabel(message, t)).toBe('ACP agent');
    }
  });

  it('keeps the real runner outside ACP Studio', () => {
    expect(assistantRoleName(runners[0]!, t)).toBe('Cursor');
    expect(assistantRoleLabel(runners[0]!, t)).toBe('Cursor · grok-4.6');
  });
});
