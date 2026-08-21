import { describe, expect, it } from 'vitest';
import {
  executionProfileFromStreamFormat,
  resolveExecutionProfile,
} from '../src/execution-profile.js';

describe('resolveExecutionProfile', () => {
  it('derives text_artifact only from plain stream format', () => {
    expect(executionProfileFromStreamFormat('plain')).toBe('text_artifact');
    expect(executionProfileFromStreamFormat('json-event-stream')).toBe('filesystem');
  });

  it('lets an adapter keep text_artifact while using JSON streaming', () => {
    expect(resolveExecutionProfile('json-event-stream', 'text_artifact')).toBe('text_artifact');
    expect(resolveExecutionProfile('json-event-stream')).toBe('filesystem');
    expect(resolveExecutionProfile('plain')).toBe('text_artifact');
  });
});
