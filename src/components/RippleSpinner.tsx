export function RippleSpinner({ size = 48 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{`
        .ripple-center { fill: #f5f5f4; }
        .ripple-ring {
          fill: none;
          stroke: #f5f5f4;
          transform-origin: center;
          animation: ripple 2s ease-out infinite;
        }
        .ripple-ring:nth-child(2) { stroke-width: 4; animation-delay: 0s; }
        .ripple-ring:nth-child(3) { stroke-width: 3; animation-delay: 0.5s; }
        .ripple-ring:nth-child(4) { stroke-width: 2; animation-delay: 1s; }
        @keyframes ripple {
          0%   { r: 8; opacity: 0.9; }
          100% { r: 44; opacity: 0; }
        }
      `}</style>
      <circle className="ripple-center" cx="50" cy="50" r="8" />
      <circle className="ripple-ring" cx="50" cy="50" r="8" />
      <circle className="ripple-ring" cx="50" cy="50" r="8" />
      <circle className="ripple-ring" cx="50" cy="50" r="8" />
    </svg>
  );
}
