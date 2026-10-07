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

  it.each([
    `AKIA${'A'.repeat(16)}`,
    `AIza${'a'.repeat(35)}`,
    `AQ.${'a'.repeat(24)}`,
    `xoxb-${'a'.repeat(24)}`,
    `nvapi-${'a'.repeat(24)}`,
    `github_pat_${'a'.repeat(80)}`,
    `pk_live_${'a'.repeat(24)}`,
    `pk-lf-${'a'.repeat(24)}`,
  ])('redacts a recognized credential in unlabeled error text: %s', (secret) => {
    expect(sanitizeSendFailureDetail(`provider rejected ${secret}; quota exhausted`))
      .toBe('provider rejected [REDACTED]; quota exhausted');
    expect(sanitizeSendFailureDetail(`${'a'.repeat(490)} ${secret}`)).not.toContain(secret.slice(0, 8));
  });

  it('redacts escaped JSON credentials without dropping the failure reason', () => {
    const detail = String.raw`provider refused: {\"access_token\":\"hidden-secret\",\"reason\":\"quota exhausted\"}`;
    const sanitized = sanitizeSendFailureDetail(detail);
    expect(sanitized).not.toContain('hidden-secret');
    expect(sanitized).toContain('quota exhausted');
    expect(sanitized).toContain('[REDACTED]');
  });
});
