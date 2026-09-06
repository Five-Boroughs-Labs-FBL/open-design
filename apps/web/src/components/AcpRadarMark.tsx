import { useId } from 'react';

type AcpRadarMarkProps = {
  size?: number;
  /** Animate sweep + orbit + pip pulse (matches Agent Control Panel LoadingMark). */
  spinning?: boolean;
  className?: string;
  title?: string;
};

/**
 * ACP radar mark — ported from Agent Control Panel (`RadarMark`).
 * Signal amber (#FF7A29). Motion: 1.6s sweep/orbit + pip pulse.
 */
export function AcpRadarMark({
  size = 24,
  spinning = true,
  className,
  title = 'ACP',
}: AcpRadarMarkProps) {
  const uid = useId().replace(/:/g, '');
  const signal = '#FF7A29';
  const ring = 'rgba(255,255,255,.22)';
  const ringInner = 'rgba(255,255,255,.14)';
  const ringCore = 'rgba(255,255,255,.08)';
  const gradId = `acpSweep-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={`acp-radar-mark${spinning ? ' is-spinning' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradId} x1="16" y1="2" x2="29" y2="14">
          <stop stopColor={signal} stopOpacity={0.5} />
          <stop offset="1" stopColor={signal} stopOpacity={0} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13.5" stroke={ring} strokeWidth="1.5" />
      <circle cx="16" cy="16" r="8.5" stroke={ringInner} strokeWidth="1.5" />
      {spinning ? (
        <circle cx="16" cy="16" r="4.4" stroke={ringCore} strokeWidth="1.25" />
      ) : null}
      <g className="acp-radar-mark__sweep">
        <path
          d="M16 16 L16 2.5 A13.5 13.5 0 0 1 27.5 9.2 Z"
          fill={`url(#${gradId})`}
        />
        <path
          d="M16 16 L27.6 9.1"
          stroke={signal}
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </g>
      {spinning ? (
        <g className="acp-radar-mark__orbit">
          <circle cx="16" cy="2.5" r="1.6" fill={signal} />
        </g>
      ) : null}
      <circle
        cx="16"
        cy="16"
        r="2.9"
        fill={signal}
        className="acp-radar-mark__pip"
      />
    </svg>
  );
}
