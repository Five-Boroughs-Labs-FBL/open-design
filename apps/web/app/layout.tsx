import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '../src/i18n';
import { AnalyticsProvider } from '../src/analytics/provider';
import '@excalidraw/excalidraw/index.css';
import '../src/index.css';
import '../src/styles/home/index.css';

export const metadata: Metadata = {
  title: 'OpenDesign',
  icons: {
    icon: '/app-icon.png',
    apple: '/app-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#f7f7f7',
};

/**
 * Inline script that runs before React hydrates so the first paint already
 * carries the app's appearance — no flash of unstyled content.
 *
 * `data-theme` is pinned to `light` for local OpenDesign. Hosted ACP Studio
 * (`design.agentcontrolpanel.dev`) stamps `data-acp-studio` in the same tick
 * and restores the stored ACP light/dark pick (default dark).
 * Keep the accent variable mix ratios in sync with `accentVars()` in
 * `src/state/appearance.ts`; this script cannot import application modules.
 */
const themeInitScript = `(function(){var root=document.documentElement;root.setAttribute('data-theme','light');try{var preview=/(?:^|[?&])acpStudio=1(?:&|$)/.test(location.search);if(preview){try{sessionStorage.setItem('od-acp-studio-preview','1');}catch(e){}}var latched=false;try{latched=sessionStorage.getItem('od-acp-studio-preview')==='1';}catch(e){}if(preview||latched||/(^|\\.)design\\.agentcontrolpanel\\.dev$/i.test(location.hostname)){var theme='dark';try{var stored=localStorage.getItem('od-acp-studio-theme');if(stored==='light'||stored==='dark')theme=stored;}catch(e){}root.setAttribute('data-theme',theme);root.setAttribute('data-acp-studio','1');document.title='ACP Design';return;}var c=JSON.parse(localStorage.getItem('open-design:config')||'{}');var a=typeof c.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(c.accentColor.trim())?c.accentColor.trim().toLowerCase():'#353535';if(c.configMigrationVersion!==3&&(a==='#87ea5c'||a==='#c96442'))a='#353535';var s=root.style;s.setProperty('--accent',a);s.setProperty('--accent-strong','color-mix(in srgb, '+a+' 82%, var(--text-strong))');s.setProperty('--accent-soft','color-mix(in srgb, '+a+' 12%, var(--bg-subtle))');s.setProperty('--accent-tint','color-mix(in srgb, '+a+' 6%, var(--bg-panel))');s.setProperty('--accent-hover','color-mix(in srgb, '+a+' 86%, var(--text-strong))');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional theme-init inline script to prevent FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
