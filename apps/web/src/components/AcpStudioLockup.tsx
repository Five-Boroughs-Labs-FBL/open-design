import { ACP_PRODUCT_SHORT } from '../acp-brand';
import { AcpRadarMark } from './AcpRadarMark';

type Props = {
  size?: number;
  compact?: boolean;
  /** Animate the radar sweep (default on for chrome lockups). */
  spinning?: boolean;
};

/** Hosted Studio lockup: animated ACP radar + “ACP”. */
export function AcpStudioLockup({
  size = 22,
  compact = false,
  spinning = true,
}: Props) {
  const markSize = compact ? Math.max(16, size - 2) : size;
  return (
    <span
      className={`acp-studio-lockup acp-studio-lockup--mark${compact ? ' acp-studio-lockup--compact' : ''}`}
      data-testid="acp-open-design-brand"
    >
      <span className="acp-studio-lockup__badge" aria-hidden>
        <AcpRadarMark size={markSize} spinning={spinning} />
      </span>
      <span className="acp-studio-lockup__wordmark">{ACP_PRODUCT_SHORT}</span>
    </span>
  );
}
