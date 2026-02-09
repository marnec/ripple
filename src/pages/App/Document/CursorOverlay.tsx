import type { CursorPosition } from "@/hooks/use-cursor-tracking";

const CURSOR_COLORS = [
  "#F44336", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5", "#2196F3",
  "#00BCD4", "#009688", "#4CAF50", "#FF9800", "#FF5722", "#795548",
];

function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getCursorColor(userId: string): string {
  return CURSOR_COLORS[hashUserId(userId) % CURSOR_COLORS.length];
}

export function CursorOverlay({
  cursors,
}: {
  cursors: Map<string, CursorPosition>;
}) {
  if (cursors.size === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {Array.from(cursors.values()).map((cursor) => {
        const color = getCursorColor(cursor.userId);
        return (
          <div
            key={cursor.userId}
            className="absolute"
            style={{
              left: `${cursor.x}%`,
              top: `${cursor.y}%`,
              transition: "left 100ms linear, top 100ms linear",
            }}
          >
            {/* Arrow SVG */}
            <svg
              width="16"
              height="20"
              viewBox="0 0 16 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
            >
              <path
                d="M0 0L0 14L4 11L7 17L10 16L7 10L12 10Z"
                fill={color}
                stroke="white"
                strokeWidth="1"
              />
            </svg>
            {/* Name label */}
            <div
              className="mt-0.5 ml-2.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {cursor.userName}
            </div>
          </div>
        );
      })}
    </div>
  );
}
