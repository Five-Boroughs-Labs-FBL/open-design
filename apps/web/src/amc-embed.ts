/**
 * AMC Design embed — when Open Design is hosted inside Agent Mission Control
 * (`?amcEmbed=1` or `?embed=1`), strip product chrome so Studio fills the frame.
 */

export const AMC_EMBED_MESSAGE_READY = "amc-design-ready";
export const AMC_EMBED_MESSAGE_COMPLETE = "amc-design-complete";

export function isAmcEmbedSearch(search = ""): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("amcEmbed") === "1" || params.get("embed") === "1";
}

export function isAmcEmbedActive(win: Window = window): boolean {
  return (
    win.document.documentElement.dataset.amcEmbed === "1" ||
    isAmcEmbedSearch(win.location.search)
  );
}

export function applyAmcEmbedFromLocation(win: Window = window): boolean {
  if (!isAmcEmbedSearch(win.location.search)) return false;
  win.document.documentElement.dataset.amcEmbed = "1";
  try {
    win.parent?.postMessage({ type: AMC_EMBED_MESSAGE_READY }, "*");
  } catch {
    // Cross-origin postMessage is always allowed with target "*".
  }
  return true;
}

export function notifyAmcDesignComplete(detail: Record<string, unknown> = {}, win: Window = window): void {
  if (win.document.documentElement.dataset.amcEmbed !== "1") return;
  try {
    win.parent?.postMessage({ type: AMC_EMBED_MESSAGE_COMPLETE, ...detail }, "*");
  } catch {
    /* ignore */
  }
}
