import { describe, expect, it } from 'vitest';
import { sanitizeSendFailureDetail } from '../src/errors.js';

describe('send failure display detail', () => {
  it('keeps useful reasons and bounds control-free display text', () => {
    expect(sanitizeSendFailureDetail('daemon 503: unavailable')).toBe('daemon 503: unavailable');
    expect(sanitizeSendFailureDetail('\u001b[31mfailed\nagain')).toBe('failed again');
    expect(sanitizeSendFailureDetail('a'.repeat(2000))).toHaveLength(500);
    expect(sanitizeSendFailureDetail(null)).toBeUndefined();
    expect(sanitizeSendFailureDetail('  ')).toBeUndefined();
  });

  it('redacts credentials before the length bound', () => {
    for (const detail of [
      'Authorization: Bearer hidden-secret',
      '{"apiKey":"hidden-secret"}',
      'password=hidden-secret',
      'https://user:hidden-secret@example.com/api?custom=hidden-secret',
      'sk-hidden-secret',
      'Cookie: sid=hidden-secret; session=another-secret',
      'Set-Cookie: sid=hidden-secret; HttpOnly',
    ]) {
      expect(sanitizeSendFailureDetail(detail)).not.toContain('hidden-secret');
      expect(sanitizeSendFailureDetail(detail)).not.toContain('another-secret');
    }
  });
});
