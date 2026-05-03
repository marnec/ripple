export const NODE_COLORS: Record<string, { light: string; dark: string }> = {
  document: { light: "#3b82f6", dark: "#60a5fa" },
  task: { light: "#8b5cf6", dark: "#a78bfa" },
  diagram: { light: "#f59e0b", dark: "#fbbf24" },
  spreadsheet: { light: "#10b981", dark: "#34d399" },
  user: { light: "#ec4899", dark: "#f472b6" },
  project: { light: "#f97316", dark: "#fb923c" },
  channel: { light: "#06b6d4", dark: "#22d3ee" },
  message: { light: "#06b6d4", dark: "#22d3ee" },
};

export const NODE_SIZE: Record<string, number> = {
  document: 5,
  task: 4,
  diagram: 5,
  spreadsheet: 5,
  user: 6,
  project: 7,
  channel: 6,
  message: 3,
};

export const NODE_TYPES = ["document", "task", "diagram", "spreadsheet", "user", "project", "channel"] as const;

export function getNodeColor(type: string, isDark: boolean): string {
  const colors = NODE_COLORS[type] ?? { light: "#6b7280", dark: "#9ca3af" };
  return isDark ? colors.dark : colors.light;
}

export function getNodeSize(type: string): number {
  return NODE_SIZE[type] ?? 4;
}
