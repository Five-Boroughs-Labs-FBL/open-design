import { describe, expect, it } from 'vitest';
import {
  apiProtocolAgentId,
  apiProtocolLabel,
  apiProtocolModelLabel,
  isMinimaxApiConfig,
} from '../../src/utils/apiProtocol';
import {
  agentDisplayName,
  agentModelDisplayName,
  exactAgentDisplayName,
} from '../../src/utils/agentLabels';

describe('api protocol labels', () => {
  it('labels the selected API protocol instead of assuming Anthropic', () => {
    expect(apiProtocolLabel('openai')).toBe('OpenAI API');
    expect(apiProtocolLabel('google')).toBe('Google Gemini');
    expect(apiProtocolLabel(undefined)).toBe('Anthropic API');
  });

  it('includes the selected model when labeling API assistant messages', () => {
    expect(apiProtocolModelLabel('openai', 'google/gemma-4-e4b')).toBe(
      'OpenAI API via OpenCode · google/gemma-4-e4b',
    );
    expect(apiProtocolModelLabel('azure', '  ')).toBe('Azure OpenAI via OpenCode');
  });

  it('includes explicit local CLI models when labeling agent messages', () => {
    expect(agentModelDisplayName('claude', 'Claude Code', 'claude-sonnet-4-6')).toBe(
      'Claude · claude-sonnet-4-6',
    );
    expect(agentModelDisplayName('claude', 'Claude Code', 'default')).toBe('Claude');
  });

  it('labels OpenCode-backed BYOK protocol agent ids', () => {
    expect(agentDisplayName('senseaudio-api')).toBe('SenseAudio API via OpenCode');
  });

  it('labels MiniMax HTTP as MiniMax, not Anthropic via OpenCode', () => {
    expect(isMinimaxApiConfig('MiniMax-M2.7-highspeed', 'https://api.minimax.io/anthropic')).toBe(true);
    expect(apiProtocolAgentId('anthropic', 'MiniMax-M2.7-highspeed', 'https://api.minimax.io/anthropic')).toBe(
      'minimax',
    );
    expect(apiProtocolModelLabel(
      'anthropic',
      'MiniMax-M2.7-highspeed',
      'https://api.minimax.io/anthropic',
    )).toBe('MiniMax · MiniMax-M2.7-highspeed');
    expect(agentDisplayName('minimax')).toBe('MiniMax');
    expect(apiProtocolModelLabel('anthropic', 'claude-opus-4', 'https://api.anthropic.com')).toBe(
      'Anthropic API via OpenCode · claude-opus-4',
    );
  });

  it('normalizes Qoder local CLI ids, aliases, and executable paths', () => {
    expect(agentDisplayName('qoder')).toBe('Qoder');
    expect(exactAgentDisplayName('qodercli')).toBe('Qoder');
    expect(exactAgentDisplayName('Qoder CLI')).toBe('Qoder');
    expect(agentDisplayName('/opt/homebrew/bin/qodercli')).toBe('Qoder');
    expect(agentDisplayName('C:\\Tools\\qodercli.cmd')).toBe('Qoder');
  });

  it('includes explicit Qoder models but hides the default model', () => {
    expect(agentModelDisplayName('qoder', 'Qoder CLI', 'ultimate')).toBe('Qoder · ultimate');
    expect(agentModelDisplayName('qoder', 'Qoder CLI', 'default')).toBe('Qoder');
  });
});
