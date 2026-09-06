import { ACP_OPEN_DESIGN_NAME, ACP_OPEN_DESIGN_SUBTITLE } from '../acp-brand';

type Props = {
  size?: number;
  compact?: boolean;
};

/** ACP radar + “ACP Open Design” lockup for the hosted Studio shell. */
export function AcpStudioLockup({ size = 22, compact = false }: Props) {
  const signal = '#FF7A29';
  return (
    <span className={`acp-studio-lockup${compact ? ' acp-studio-lockup--compact' : ''}`} data-testid="acp-open-design-brand">
      <svg
        className="acp-studio-lockup__mark"
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
      >
        <circle cx="16" cy="16" r="13.5" stroke="rgba(24,20,16,.28)" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="8.5" stroke="rgba(24,20,16,.18)" strokeWidth="1.5" />
        <path
          d="M16 16 L16 2.5 A13.5 13.5 0 0 1 27.5 9.2 Z"
          fill={signal}
          fillOpacity="0.35"
        />
        <path d="M16 16 L27.6 9.1" stroke={signal} strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.9" fill={signal} />
      </svg>
      <span className="acp-studio-lockup__text">
        <span className="acp-studio-lockup__name">{ACP_OPEN_DESIGN_NAME}</span>
        {compact ? null : (
          <span className="acp-studio-lockup__sub">{ACP_OPEN_DESIGN_SUBTITLE}</span>
        )}
      </span>
    </span>
  );
}
