import ColorHash from "color-hash";

// Create a singleton ColorHash instance with vibrant, readable colors
const colorHash = new ColorHash({
  lightness: [0.5, 0.6, 0.7],
  saturation: [0.6, 0.7, 0.8],
});

/**
 * Get a deterministic color for a user ID.
 * Same user ID always returns the same color.
 */
export function getUserColor(userId: string): string {
  return colorHash.hex(userId);
}

/**
 * Replicate Excalidraw's internal getClientColor, then apply the same
 * CSS filter that dark-mode Excalidraw applies to its canvas:
 *   filter: invert(93%) hue-rotate(180deg)
 *
 * This ensures our HTML avatar colors match the canvas cursors in both
 * light and dark themes.
 */
export function getExcalidrawCollaboratorColor(
  clientId: number,
  isDarkTheme: boolean,
): string {
  const hash = Math.abs(hashToInteger(String(clientId)));
  const hue = (hash % 37) * 10;

  if (!isDarkTheme) {
    return `hsl(${hue}, 100%, 83%)`;
  }

  // In dark mode, Excalidraw applies "invert(93%) hue-rotate(180deg)" to all
  // <canvas> elements via CSS. We replicate that transform in JS so our
  // HTML avatars match.
  const { r, g, b } = hslToRgb(hue, 100, 83);
  const inv = applyInvert(r, g, b, 0.93);
  const rotated = applyHueRotate(inv.r, inv.g, inv.b, 180);
  return `rgb(${Math.round(rotated.r)}, ${Math.round(rotated.g)}, ${Math.round(rotated.b)})`;
}

function hashToInteger(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
  }
  return hash;
}

/** Convert HSL (h: 0-360, s: 0-100, l: 0-100) to RGB (0-255). */
function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const s1 = s / 100;
  const l1 = l / 100;
  const c = (1 - Math.abs(2 * l1 - 1)) * s1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l1 - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c; g = x;
  } else if (h < 120) {
    r = x; g = c;
  } else if (h < 180) {
    g = c; b = x;
  } else if (h < 240) {
    g = x; b = c;
  } else if (h < 300) {
    r = x; b = c;
  } else {
    r = c; b = x;
  }
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

/** CSS invert() filter: blend each channel toward its inverse. */
function applyInvert(
  r: number,
  g: number,
  b: number,
  amount: number,
): { r: number; g: number; b: number } {
  return {
    r: r + (255 - 2 * r) * amount,
    g: g + (255 - 2 * g) * amount,
    b: b + (255 - 2 * b) * amount,
  };
}

/** CSS hue-rotate() filter applied in linear RGB space. */
function applyHueRotate(
  r: number,
  g: number,
  b: number,
  degrees: number,
): { r: number; g: number; b: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // W3C filter-effects spec hue-rotate matrix
  const matrix = [
    0.213 + 0.787 * cos - 0.213 * sin,
    0.715 - 0.715 * cos - 0.715 * sin,
    0.072 - 0.072 * cos + 0.928 * sin,
    0.213 - 0.213 * cos + 0.143 * sin,
    0.715 + 0.285 * cos + 0.140 * sin,
    0.072 - 0.072 * cos - 0.283 * sin,
    0.213 - 0.213 * cos - 0.787 * sin,
    0.715 - 0.715 * cos + 0.715 * sin,
    0.072 + 0.928 * cos + 0.072 * sin,
  ];
  return {
    r: clamp(r * matrix[0] + g * matrix[1] + b * matrix[2]),
    g: clamp(r * matrix[3] + g * matrix[4] + b * matrix[5]),
    b: clamp(r * matrix[6] + g * matrix[7] + b * matrix[8]),
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/**
 * Get a deterministic color with alpha transparency for a user ID.
 * Useful for selection highlights and cursor backgrounds.
 */
export function getUserColorWithAlpha(userId: string, alpha: number): string {
  const hex = getUserColor(userId);
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Convert hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace("#", "");

  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  return { r, g, b };
}
