import { useEffect, useState } from 'react';

import {
  ACP_STUDIO_THEME_EVENT,
  readAcpStudioTheme,
  toggleAcpStudioTheme,
  type AcpStudioTheme,
} from '../acp-brand';
import { useI18n } from '../i18n';

type Props = {
  className?: string;
};

/**
 * Compact day / night switch for hosted ACP Studio. Visual only shows
 * sun ↔ moon; state is announced via aria-label.
 */
export function AcpStudioThemeToggle({ className }: Props) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<AcpStudioTheme>(() =>
    typeof window === 'undefined' ? 'dark' : readAcpStudioTheme(window),
  );

  useEffect(() => {
    const sync = () => setTheme(readAcpStudioTheme());
    window.addEventListener(ACP_STUDIO_THEME_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ACP_STUDIO_THEME_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const next = theme === 'light' ? 'dark' : 'light';
  const label = next === 'light' ? t('acpStudio.switchToLight') : t('acpStudio.switchToDark');
  const classes = ['acp-studio-theme-toggle', theme === 'light' ? 'is-day' : 'is-night'];
  if (className) classes.push(className);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={() => setTheme(toggleAcpStudioTheme())}
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title={label}
      data-testid="acp-studio-theme-toggle"
    >
      <span className="acp-studio-theme-toggle__track" aria-hidden="true">
        <span className="acp-studio-theme-toggle__icon acp-studio-theme-toggle__icon--sun">
          <SunIcon />
        </span>
        <span className="acp-studio-theme-toggle__icon acp-studio-theme-toggle__icon--moon">
          <MoonIcon />
        </span>
        <span className="acp-studio-theme-toggle__knob" />
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path
        d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M20.5 14.2A8.2 8.2 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"
        fill="currentColor"
      />
    </svg>
  );
}
