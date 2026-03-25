const ringBase: React.CSSProperties = {
  fill: "none",
  transformOrigin: "center",
  animation: "ripple 2s ease-out infinite",
};

export function RippleSpinner({ size = 48, color = "#f5f5f4" }: { size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{`
        @keyframes ripple {
          0%   { r: 8; opacity: 0.9; }
          100% { r: 44; opacity: 0; }
        }
      `}</style>
      <circle cx="50" cy="50" r="8" style={{ fill: color }} />
      <circle cx="50" cy="50" r="8" style={{ ...ringBase, stroke: color, strokeWidth: 4, animationDelay: "0s" }} />
      <circle cx="50" cy="50" r="8" style={{ ...ringBase, stroke: color, strokeWidth: 3, animationDelay: "0.5s" }} />
      <circle cx="50" cy="50" r="8" style={{ ...ringBase, stroke: color, strokeWidth: 2, animationDelay: "1s" }} />
    </svg>
  );
}
