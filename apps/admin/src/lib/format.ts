const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const fmtNum = (n: number) => numberFormat.format(n);

export const fmtDate = (ts: number) => dateFormat.format(ts);

/** Compact relative time: "just now", "3h ago", "12d ago", else a date. */
export function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return fmtDate(ts);
}

/** Initials for an avatar fallback, derived from name or email. */
export function initials(name?: string, email?: string): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Short id tail for dense tables, e.g. "…f23hhtqv". */
export const shortId = (id: string) => "…" + id.slice(-8);
