import { ACP_PRODUCT_WORDMARK } from '../acp-brand';

type Props = {
  size?: number;
  compact?: boolean;
  /** Kept for call-site compatibility; the radar mark is no longer shown. */
  spinning?: boolean;
};

/** Hosted Studio lockup: “AGENT CONTROL PANEL” wordmark, no logo. */
export function AcpStudioLockup({
  compact = false,
}: Props) {
  return (
    <span
      className={`acp-studio-lockup${compact ? ' acp-studio-lockup--compact' : ''}`}
      data-testid="acp-open-design-brand"
    >
      <span className="acp-studio-lockup__wordmark">{ACP_PRODUCT_WORDMARK}</span>
    </span>
  );
}
