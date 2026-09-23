/**
 * Persist-time HTML document shape.
 *
 * A live canvas file must be exactly one HTML document. Later-turn dumps that
 * start with `<!DOCTYPE html>` still fail this check when they mix thinking,
 * markdown fences, or a nested second document into the same body.
 *
 * Detection is structural — doctype count, a markdown fence that opens a
 * nested document, `<style>` that contains markup or a fence, an unclosed
 * quoted attribute (thinking jammed into viewport meta), and stray prose
 * text nodes in `<head>`. It does not match thinking phrases.
 */

const DOCTYPE_RE = /<!doctype\s+html\b/gi;
const STARTS_WITH_DOCUMENT_RE = /^\s*(?:<!doctype\s+html\b|<html\b)/i;
const MARKDOWN_HTML_FENCE_RE = /```(?:html)?[ \t]*\r?\n/i;
const NESTED_DOCUMENT_AFTER_FENCE_RE =
  /```(?:html)?[ \t]*\r?\n[\s\S]*?(?:<!doctype\s+html\b|<html\b)/i;
const STYLE_OPEN_RE = /<style\b[^>]*>/i;
const STYLE_CLOSE_RE = /<\/style\s*>/i;
const STYLE_MARKUP_RE = /<!doctype\s+html\b|<html\b|<\/html\s*>|```/i;
const LEADING_DOCTYPE_RE = /^\s*<!doctype\s+html\b[^>]*>/i;
const TAG_RANGE_SUMMARY_RE = /^`?\s*(?:→|->|…|\.\.\.)\s*`?\s*<\/html\s*>`?(?:\s|$)/i;

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
  // A model can mention the boundary tags in prose, for example
  // `<!DOCTYPE html>` → `</html>`. It starts like HTML, but the markdown
  // delimiter/arrow after the doctype makes it a description, not a page.
  // Keep ordinary HTML5 text-only bodies valid; don't require an <html> tag.
  const normalized = content.replace(/^\uFEFF/, '');
  const doctype = normalized.match(LEADING_DOCTYPE_RE);
  if (doctype) {
    const afterDoctype = normalized.slice(doctype[0].length).trimStart();
    if (TAG_RANGE_SUMMARY_RE.test(afterDoctype)) return true;
  }
  if (countHtmlDoctypes(content) > 1) return true;
  if (NESTED_DOCUMENT_AFTER_FENCE_RE.test(content)) return true;
  if (MARKDOWN_HTML_FENCE_RE.test(content) && countHtmlDoctypes(content) >= 1) {
    return true;
  }
  if (hasUnclosedQuotedAttribute(content)) return true;
  if (headHasStrayProse(content)) return true;
  return styleContainsMarkupOrFence(content);
}

export function isSingleHtmlDocument(content: string): boolean {
  return startsLikeHtmlDocument(content) && !isMixedHtmlDocument(content);
}

/** Closed `</html>` and not mixed. A streaming draft is not this. */
export function isCompleteSingleHtmlDocument(content: string): boolean {
  return isSingleHtmlDocument(content) && /<\/html\s*>/i.test(content);
}

const ARTIFACT_OPEN_RE = /<artifact\s[^>]*>/i;
const ARTIFACT_CLOSE_TAG = '</artifact>';

/**
 * A later-turn live primary can restart as a single `<artifact>` envelope
 * after a broken first document (DOCTYPE / html / head, then the tag, then a
 * second DOCTYPE). Persist the inner page when that inner page is itself a
 * single HTML document. Do not salvage a nested document from thinking or a
 * markdown fence — those stay mixed.
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
  return isSingleHtmlDocument(inner) ? inner : null;
}

/**
 * Thinking jammed into an unclosed attribute (the live REPL leak: viewport
 * `content="width=device-width, initial-scale=1.0 I'll spawn…`). Skip
 * `<script>` / `<style>` bodies so CSS/JS strings are not HTML attributes.
 */
function hasUnclosedQuotedAttribute(content: string): boolean {
  let i = 0;
  const n = content.length;
  while (i < n) {
    const lt = content.indexOf('<', i);
    if (lt < 0) return false;
    if (content.startsWith('<!--', lt)) {
      const end = content.indexOf('-->', lt + 4);
      if (end < 0) return false;
      i = end + 3;
      continue;
    }
    const rest = content.slice(lt);
    const special = rest.match(/^<(script|style)\b/i);
    const parsed = readHtmlTag(content, lt);
    if (parsed.unclosedQuote) return true;
    const tagName = special?.[1];
    if (tagName) {
      const close = new RegExp(`</${tagName}\\s*>`, 'i');
      const closeRel = content.slice(parsed.nextIndex).search(close);
      i = closeRel < 0 ? n : parsed.nextIndex + closeRel + tagName.length + 3;
      continue;
    }
    i = parsed.nextIndex;
  }
  return false;
}

function readHtmlTag(content: string, start: number): { nextIndex: number; unclosedQuote: boolean } {
  let quote: '"' | "'" | null = null;
  for (let i = start + 1; i < content.length; i += 1) {
    const ch = content[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return { nextIndex: i + 1, unclosedQuote: false };
  }
  return { nextIndex: content.length, unclosedQuote: quote != null };
}

/**
 * Direct text nodes in `<head>` (outside title/style/script) are agent
 * write-ups, not a document. `<title>` copy is stripped first.
 */
function headHasStrayProse(content: string): boolean {
  const match = content.match(/<head\b[^>]*>([\s\S]*?)(?:<\/head\s*>|$)/i);
  if (!match) return false;
  let inner = match[1] ?? '';
  inner = inner.replace(/<!--[\s\S]*?-->/g, '');
  inner = inner.replace(/<(script|style|title|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  inner = inner.replace(/<[^>]+>/g, ' ');
  const leftover = inner.replace(/\s+/g, ' ').trim();
  return /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(leftover);
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
