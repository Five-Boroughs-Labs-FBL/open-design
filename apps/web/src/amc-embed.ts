/**
 * ACP Design embed — when Open Design is hosted inside Agent Control Panel
 * (`?acpEmbed=1`, legacy `?amcEmbed=1`, or `?embed=1`), strip product chrome
 * so Studio fills the frame.
 */

export const AMC_EMBED_MESSAGE_READY = "amc-design-ready";
export const AMC_EMBED_MESSAGE_COMPLETE = "amc-design-complete";
export const ACP_EMBED_MESSAGE_READY = "acp-design-ready";
export const ACP_EMBED_MESSAGE_COMPLETE = "acp-design-complete";
export const OD_EMBED_SESSION_KEY = "od-embed-session";

export function isAmcEmbedSearch(search = ""): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("acpEmbed") === "1" || params.get("amcEmbed") === "1" || params.get("embed") === "1";
}

export function hasEmbedGrantQuery(search = ""): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const token = params.get("t");
  return typeof token === "string" && token.length > 0;
}

export function isAmcEmbedActive(win: Window = window): boolean {
  return (
    win.document.documentElement.dataset.amcEmbed === "1" ||
    win.document.documentElement.dataset.acpEmbed === "1" ||
    isAmcEmbedSearch(win.location.search)
  );
}

export function rememberEmbedGrantSession(win: Window = window): boolean {
  if (hasEmbedGrantQuery(win.location.search)) {
    try {
      win.sessionStorage.setItem(OD_EMBED_SESSION_KEY, "1");
    } catch {
      /* private mode */
    }
    return true;
  }
  try {
    return win.sessionStorage.getItem(OD_EMBED_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyAmcEmbedFromLocation(win: Window = window): boolean {
  rememberEmbedGrantSession(win);
  if (!isAmcEmbedSearch(win.location.search)) return false;
  win.document.documentElement.dataset.amcEmbed = "1";
  win.document.documentElement.dataset.acpEmbed = "1";
  try {
    win.parent?.postMessage({ type: AMC_EMBED_MESSAGE_READY }, "*");
    win.parent?.postMessage({ type: ACP_EMBED_MESSAGE_READY }, "*");
  } catch {
    // Cross-origin postMessage is always allowed with target "*".
  }
  return true;
}

export function notifyAmcDesignComplete(detail: Record<string, unknown> = {}, win: Window = window): void {
  if (
    win.document.documentElement.dataset.amcEmbed !== "1"
    && win.document.documentElement.dataset.acpEmbed !== "1"
  ) return;
  try {
    win.parent?.postMessage({ type: AMC_EMBED_MESSAGE_COMPLETE, ...detail }, "*");
    win.parent?.postMessage({ type: ACP_EMBED_MESSAGE_COMPLETE, ...detail }, "*");
  } catch {
    /* ignore */
  }
}
