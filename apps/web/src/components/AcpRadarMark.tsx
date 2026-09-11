import {
  ACP_LOGO_INK,
  ACP_MARK_INNER,
  ACP_MARK_OUTER,
  ACP_MARK_VIEWBOX,
} from './acpMarkGeometry';

type AcpRadarMarkProps = {
  size?: number;
  /** Pulse the cyan glow like the Agent Control Panel lockup. */
  spinning?: boolean;
  variant?: 'default' | 'light' | 'mono';
  className?: string;
  title?: string;
};

/**
 * ACP peak mark — nested A from Agent Control Panel (`RadarMark`).
 * Dark: ice cyan. Light (bare): navy ink. Marks on the navy lockup tile stay cyan.
 */
export function AcpRadarMark({
  size = 24,
  spinning = true,
  variant = 'default',
  className,
  title = 'ACP',
}: AcpRadarMarkProps) {
  const paint = variant === 'light' ? ACP_LOGO_INK : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox={ACP_MARK_VIEWBOX}
      fill="none"
      className={`acp-mark${spinning ? ' is-spinning' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={title}
    >
      <path fill={paint} fillRule="evenodd" d={ACP_MARK_OUTER} />
      <path fill={paint} d={ACP_MARK_INNER} />
    </svg>
  );
}
