import { ACP_OPEN_DESIGN_NAME, ACP_PRODUCT_WORDMARK } from '../acp-brand';
import { AcpRadarMark } from './AcpRadarMark';

type Props = {
  size?: number;
  compact?: boolean;
  spinning?: boolean;
  /** `chrome` is the top-bar / SSO mark + “ACP Design”. `rail` is the sidebar wordmark. */
  variant?: 'chrome' | 'rail';
};

/** Hosted Studio lockup. */
export function AcpStudioLockup({
  size = 22,
  compact = false,
  spinning = true,
  variant = 'chrome',
}: Props) {
  const markSize = compact ? Math.max(16, size - 2) : size;
  const wordmark = variant === 'rail' ? ACP_PRODUCT_WORDMARK : ACP_OPEN_DESIGN_NAME;
  return (
    <span
      className={`acp-studio-lockup acp-studio-lockup--${variant}${compact ? ' acp-studio-lockup--compact' : ''}`}
      data-testid="acp-open-design-brand"
    >
      {variant === 'chrome' ? (
        <span className="acp-studio-lockup__badge" aria-hidden>
          <AcpRadarMark size={markSize} spinning={spinning} />
        </span>
      ) : null}
      <span className="acp-studio-lockup__wordmark">{wordmark}</span>
    </span>
  );
}
