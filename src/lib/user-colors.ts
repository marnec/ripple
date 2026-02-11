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
