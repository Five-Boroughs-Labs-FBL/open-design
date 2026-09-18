import { describe, expect, it } from 'vitest';

import {
  modelIdFromAgentDisplayName,
  retryAssistantAgentId,
  retryAssistantModel,
} from '../../src/components/retry-run-identity';

describe('retry-run-identity', () => {
  it('keeps cursor-agent when the failed turn was Cursor running grok-4.6', () => {
    expect(retryAssistantAgentId(
      { agentId: 'cursor-agent' },
      'grok-build',
    )).toBe('cursor-agent');
    expect(retryAssistantModel(
      { agentName: 'Cursor Agent · grok-4.6' },
      'auto',
    )).toBe('grok-4.6');
  });

  it('keeps Cursor Auto off the grok-build picker', () => {
    expect(retryAssistantAgentId(
      { agentId: 'cursor-agent' },
      'grok-build',
    )).toBe('cursor-agent');
    expect(retryAssistantModel(
      { agentName: 'Cursor · auto' },
      'grok-4.6',
    )).toBe('auto');
  });

  it('falls back to the picker only when the failed turn has no agent', () => {
    expect(retryAssistantAgentId({}, 'grok-build')).toBe('grok-build');
    expect(retryAssistantAgentId(null, 'cursor-agent')).toBe('cursor-agent');
    expect(modelIdFromAgentDisplayName('Cursor Agent')).toBeNull();
    expect(retryAssistantModel({ agentName: 'Cursor Agent' }, 'composer-2.5'))
      .toBe('composer-2.5');
  });
});
