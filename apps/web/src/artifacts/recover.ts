import { validateHtmlArtifact } from './validate';

export type RecoverHtmlArtifactInput = {
  artifactHtml: string;
  identifier?: string;
  sourceText?: string;
  hasPreviousSingleDocument?: boolean;
};

const ARTIFACT_OPEN_RE = /<artifact\s[^>]*>/i;
const ARTIFACT_CLOSE_TAG = '</artifact>';

/**
 * Later-turn live primary can restart as one `<artifact>` envelope after a
 * broken first document. Persist only the inner page when that inner page is
 * itself a single HTML document.
 */
export function unwrapSingleHtmlArtifactEnvelope(content: string): string | null {
  if (!content) return null;
  const openMatch = content.match(ARTIFACT_OPEN_RE);
  if (!openMatch || openMatch.index == null) return null;
  const afterOpen = openMatch.index + openMatch[0].length;
  if (ARTIFACT_OPEN_RE.test(content.slice(afterOpen))) return null;
  const closeStart = content.indexOf(ARTIFACT_CLOSE_TAG, afterOpen);
  const inner = (closeStart >= 0
    ? content.slice(afterOpen, closeStart)
    : content.slice(afterOpen)).trim();
  return validateHtmlArtifact(inner).ok ? inner : null;
}

export type HtmlArtifactPersistDecision =
  | { action: 'persist'; html: string }
  | { action: 'keep-previous' }
  | { action: 'refuse'; reason: string };

/**
 * Persist-time decision for a later-turn HTML artifact.
 * Unwrap a single envelope when the inner page is clean. If the candidate is
 * still mixed and a previous single document exists, keep that previous file
 * instead of refusing the run.
 */
export function decideHtmlArtifactPersist(
  input: RecoverHtmlArtifactInput,
): HtmlArtifactPersistDecision {
  const html = resolvePersistedArtifactHtml(input);
  const validation = validateHtmlArtifact(html);
  if (validation.ok) return { action: 'persist', html };
  const mixed = /single HTML document/i.test(validation.reason);
  if (mixed && input.hasPreviousSingleDocument) return { action: 'keep-previous' };
  return { action: 'refuse', reason: validation.reason };
}

const HTML_OPEN_RE = /<html\b/gi;
const HTML_CLOSE_RE = /<\/html\s*>/gi;
const ADJACENT_DOCTYPE_RE = /<!doctype\s+html\b[^>]*>\s*$/i;
const HTML_FENCE_RE = /```(?:html|HTML)\s*\n([\s\S]*?)\n```/g;

function findLastArtifactOpen(sourceText: string, identifier?: string): number {
  if (!identifier) return sourceText.lastIndexOf('<artifact');

  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taggedOpenRe = new RegExp(
    `<artifact\\b(?=[^>]*\\bidentifier\\s*=\\s*(?:"${escapedIdentifier}"|'${escapedIdentifier}'))[^>]*>`,
    'gi',
  );
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = taggedOpenRe.exec(sourceText)) !== null) {
    last = match.index;
  }
  return last !== -1 ? last : sourceText.lastIndexOf('<artifact');
}

function lastIndexOfRegex(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    last = match.index;
  }
  return last;
}

export function recoverHtmlArtifactFromPrecedingDocument({
  artifactHtml,
  identifier,
  sourceText,
}: RecoverHtmlArtifactInput): string | null {
  if (!sourceText) return null;
  if (validateHtmlArtifact(artifactHtml).ok) return null;

  const artifactOpen = findLastArtifactOpen(sourceText, identifier);
  if (artifactOpen === -1) return null;

  const beforeArtifact = sourceText.slice(0, artifactOpen);
  if (!/<\/html\s*>\s*$/i.test(beforeArtifact)) return null;

  const htmlOpenStart = lastIndexOfRegex(HTML_OPEN_RE, beforeArtifact);
  const htmlClose = lastIndexOfRegex(HTML_CLOSE_RE, beforeArtifact);
  if (htmlOpenStart === -1 || htmlClose === -1 || htmlClose < htmlOpenStart) return null;

  const closeMatch = beforeArtifact.slice(htmlClose).match(/^<\/html\s*>/i);
  if (!closeMatch) return null;

  const beforeHtmlOpen = beforeArtifact.slice(0, htmlOpenStart);
  const adjacentDoctype = beforeHtmlOpen.match(ADJACENT_DOCTYPE_RE);
  const htmlStart = adjacentDoctype
    ? htmlOpenStart - adjacentDoctype[0].length
    : htmlOpenStart;

  const candidate = beforeArtifact.slice(htmlStart, htmlClose + closeMatch[0].length).trim();
  return validateHtmlArtifact(candidate).ok ? candidate : null;
}

/**
 * Resolve the HTML that will actually be persisted for an artifact. When the
 * model emits a prose-only `<artifact>` next to a complete `<html>` document in
 * the same turn, recover the real document from the preceding text; otherwise
 * keep the artifact body as-is.
 *
 * The same-turn dedup lookup and the persist path MUST resolve this
 * identically. Feeding the lookup the raw prose summary while persisting the
 * recovered document makes the normalized exact-match miss the same-turn Write
 * file, so the recovered document persists a second time as a duplicate (#4318).
 */
export function resolvePersistedArtifactHtml(input: RecoverHtmlArtifactInput): string {
  return recoverHtmlArtifactFromPrecedingDocument(input)
    ?? unwrapSingleHtmlArtifactEnvelope(input.artifactHtml)
    ?? unwrapSingleHtmlArtifactEnvelope(input.sourceText ?? '')
    ?? input.artifactHtml;
}

export function recoverStandaloneHtmlDocument(sourceText: string | null | undefined): string | null {
  const candidate = String(sourceText || '').replace(/^﻿/, '').trim();
  if (!/<\/html\s*>$/i.test(candidate)) return null;
  return validateHtmlArtifact(candidate).ok ? candidate : null;
}

export function recoverHtmlDocumentFromMarkdownFence(sourceText: string | null | undefined): string | null {
  const text = String(sourceText || '');
  HTML_FENCE_RE.lastIndex = 0;
  let recovered: string | null = null;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_FENCE_RE.exec(text)) !== null) {
    const candidate = (match[1] || '').replace(/^﻿/, '').trim();
    if (!/<\/html\s*>$/i.test(candidate)) continue;
    if (!validateHtmlArtifact(candidate).ok) continue;
    recovered = candidate;
    count += 1;
  }
  return count === 1 ? recovered : null;
}
