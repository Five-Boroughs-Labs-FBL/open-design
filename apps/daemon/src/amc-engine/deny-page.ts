export const AMC_ENGINE_DENY_TITLE = 'ACP Design engine';
export const AMC_ENGINE_DENY_BODY =
  'Open a design from Agent Control Panel.';

export function amcEngineDenyHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${AMC_ENGINE_DENY_TITLE}</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #111; color: #eee; font: 16px/1.45 system-ui, sans-serif; }
    main { max-width: 36rem; margin: 20vh auto; padding: 0 1.5rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #bbb; }
  </style>
</head>
<body>
  <main>
    <h1>${AMC_ENGINE_DENY_TITLE}</h1>
    <p>${AMC_ENGINE_DENY_BODY}</p>
  </main>
</body>
</html>`;
}

export function sendAmcEngineDeny(res: { status: (code: number) => { type: (t: string) => { send: (body: string) => unknown } } }): void {
  res.status(404).type('html').send(amcEngineDenyHtml());
}

export const AMC_ENGINE_MARKER_SCRIPT =
  '<script>window.__OD_AMC_ENGINE__=true;document.documentElement.dataset.odAmcEngine="1";</script>';

export function injectAmcEngineMarker(html: string): string {
  const raw = String(html || '');
  if (raw.includes('__OD_AMC_ENGINE__')) return raw;
  if (/<head[^>]*>/i.test(raw)) {
    return raw.replace(/<head[^>]*>/i, (open) => `${open}${AMC_ENGINE_MARKER_SCRIPT}`);
  }
  return `${AMC_ENGINE_MARKER_SCRIPT}${raw}`;
}
