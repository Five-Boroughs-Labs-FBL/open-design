/** Live leak from 2026-08-25 AMC later-turn persist of index.html. */
export const LIVE_PRIMARY_LEAK_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<style>',
  "@import url('https://fonts.googleapis.I'll read the login page and tighten the mobile layout: stacked form, larger tap targets, no sideways scroll. The file seems corrupted or truncated? That's weird. Let me try reading it again... The output looks like the file got overwritten with my thinking text? That would be very bad...",
  '```html',
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<title>Atlas Queue • Login</title>',
  '<style>body{background:#0b0d10;color:#e8eaed}</style>',
  '</head>',
  '<body><h1>Sign in</h1></body>',
  '</html>',
].join('\n');

export const CLEAN_LOGIN_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<title>Atlas Queue • Login</title>',
  '<style>body{background:#0b0d10;color:#e8eaed}button{min-height:48px}</style>',
  '</head>',
  '<body><h1>Sign in</h1></body>',
  '</html>',
].join('\n');

/** Inner page from the 2026-08-25 live Login follow-up (clean after unwrap). */
export const MOBILE_LOGIN_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<title>FRUN Ops HUD - Sign in</title>',
  '<style>:root{--bg:oklch(0.16 0.012 250);--tap:52px}body{margin:0}</style>',
  '</head>',
  '<body><h1>Sign in</h1><button style="min-height:var(--tap)">ENTER HUD</button></body>',
  '</html>',
].join('\n');

/**
 * Live leak after #17: a later-turn Login stream starts a first document,
 * then restarts inside `<artifact identifier="login">` with a second DOCTYPE.
 * No thinking prose, no markdown fence. The inner page is a single document.
 */
export const ARTIFACT_ENVELOPE_LEAK_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.',
  `<artifact identifier="login" type="text/html" title="Login">`,
  MOBILE_LOGIN_HTML,
  '</artifact>',
].join('\n');

/** Same restart while `</artifact>` has not arrived yet — the live dump shape. */
export const ARTIFACT_ENVELOPE_LEAK_OPEN_HTML = ARTIFACT_ENVELOPE_LEAK_HTML.replace(
  /\n<\/artifact>\s*$/,
  '',
);

/** Same envelope restart, but the inner page is itself mixed. */
export const ARTIFACT_ENVELOPE_MIXED_INNER_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.',
  `<artifact identifier="login" type="text/html" title="Login">`,
  LIVE_PRIMARY_LEAK_HTML,
  '</artifact>',
].join('\n');
