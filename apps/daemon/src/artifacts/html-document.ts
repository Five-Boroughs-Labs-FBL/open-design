/**
 * Persist-time HTML document shape.
 *
 * A live canvas file must be exactly one HTML document. Later-turn dumps that
 * start with `<!DOCTYPE html>` still fail this check when they mix thinking,
 * markdown fences, or a nested second document into the same body.
 *
 * Detection is structural — doctype count, a markdown fence that opens a
 * nested document, and `<style>` that contains markup or a fence. It does
 * not match thinking phrases.
 */

const DOCTYPE_RE = /<!doctype\s+html\b/gi;
const STARTS_WITH_DOCUMENT_RE = /^\s*(?:<!doctype\s+html\b|<html\b)/i;
const MARKDOWN_HTML_FENCE_RE = /```(?:html)?[ \t]*\r?\n/i;
const NESTED_DOCUMENT_AFTER_FENCE_RE =
  /```(?:html)?[ \t]*\r?\n[\s\S]*?(?:<!doctype\s+html\b|<html\b)/i;
const STYLE_OPEN_RE = /<style\b[^>]*>/i;
const STYLE_CLOSE_RE = /<\/style\s*>/i;
const STYLE_MARKUP_RE = /<!doctype\s+html\b|<html\b|<\/html\s*>|```/i;

export function countHtmlDoctypes(content: string): number {
  const matches = content.match(DOCTYPE_RE);
  return matches?.length ?? 0;
}

export function startsLikeHtmlDocument(content: string): boolean {
  return STARTS_WITH_DOCUMENT_RE.test(content.replace(/^\uFEFF/, ''));
}

/**
 * True when `content` is not a single persistable HTML document.
 * A naive "starts with DOCTYPE" check is not enough.
 */
export function isMixedHtmlDocument(content: string): boolean {
  if (!content) return false;
  if (countHtmlDoctypes(content) > 1) return true;
  if (NESTED_DOCUMENT_AFTER_FENCE_RE.test(content)) return true;
  if (MARKDOWN_HTML_FENCE_RE.test(content) && countHtmlDoctypes(content) >= 1) {
    return true;
  }
  return styleContainsMarkupOrFence(content);
}

export function isSingleHtmlDocument(content: string): boolean {
  return startsLikeHtmlDocument(content) && !isMixedHtmlDocument(content);
}

function styleContainsMarkupOrFence(content: string): boolean {
  let searchFrom = 0;
  while (searchFrom < content.length) {
    const open = content.slice(searchFrom).search(STYLE_OPEN_RE);
    if (open < 0) return false;
    const openAt = searchFrom + open;
    const openMatch = content.slice(openAt).match(STYLE_OPEN_RE);
    if (!openMatch) return false;
    const bodyStart = openAt + openMatch[0].length;
    const closeRel = content.slice(bodyStart).search(STYLE_CLOSE_RE);
    const body = closeRel < 0
      ? content.slice(bodyStart)
      : content.slice(bodyStart, bodyStart + closeRel);
    if (STYLE_MARKUP_RE.test(body)) return true;
    if (closeRel < 0) return false;
    searchFrom = bodyStart + closeRel + 8;
  }
  return false;
}
