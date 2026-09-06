export function isAmcEngineBoot(win: Window = window): boolean {
  if (typeof win === 'undefined' || !win.document) return false;
  return (
    (win as Window & { __OD_AMC_ENGINE__?: boolean }).__OD_AMC_ENGINE__ === true
    || win.document.documentElement?.dataset?.odAmcEngine === '1'
  );
}
