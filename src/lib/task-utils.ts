export function formatTaskId(
  projectKey?: string,
  number?: number,
): string | undefined {
  if (!projectKey || number == null) return undefined;
  return `${projectKey}-${number}`;
}

export function isOverdue(dueDate: string): boolean {
  const due = new Date(dueDate + "T23:59:59");
  return due < new Date();
}

export function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatEstimate(hours: number): string {
  return `${hours}h`;
}

export const ESTIMATE_PRESETS = [0.5, 1, 2, 4, 8, 16, 24, 40] as const;
