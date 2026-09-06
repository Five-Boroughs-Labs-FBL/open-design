import { ACP_OPEN_DESIGN_SUBTITLE } from '../acp-brand';

type Props = {
  size?: number;
  compact?: boolean;
};

/** Hosted Studio rail/header wordmark — subtitle only (no radar mark, no product name). */
export function AcpStudioLockup({ size: _size = 22, compact = false }: Props) {
  return (
    <span
      className={`acp-studio-lockup acp-studio-lockup--wordmark${compact ? ' acp-studio-lockup--compact' : ''}`}
      data-testid="acp-open-design-brand"
    >
      <span className="acp-studio-lockup__sub">{ACP_OPEN_DESIGN_SUBTITLE}</span>
    </span>
  );
}
