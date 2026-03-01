export function RippleLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      className={className}
      aria-label="Ripple"
    >
      <circle cx="256" cy="256" r="48" fill="currentColor" opacity="1" />
      <circle
        cx="256"
        cy="256"
        r="96"
        stroke="currentColor"
        strokeWidth="8"
        opacity="0.7"
      />
      <circle
        cx="256"
        cy="256"
        r="144"
        stroke="currentColor"
        strokeWidth="6"
        opacity="0.45"
      />
      <circle
        cx="256"
        cy="256"
        r="192"
        stroke="currentColor"
        strokeWidth="4"
        opacity="0.25"
      />
    </svg>
  );
}
