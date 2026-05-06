/**
 * Pure helpers for the event create/edit surfaces. Lives in its own file
 * (no React component exports) so that `event-fields.tsx` remains
 * fast-refresh-clean — Vite's React Fast Refresh only re-runs modules whose
 * exports are all components, and bundling utils alongside components in
 * one file degrades the dev edit loop.
 */

export const TIME_RE = /^\d{2}:\d{2}$/;

/** "00:00" … "23:45" in 15-minute increments — Google-Calendar default for
 *  the visible dropdown. Free-typed times (parsed by `parseTypedTime`) can
 *  fall on any minute and bypass this list entirely. */
export const TIME_OPTIONS: ReadonlyArray<string> = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Quantise an ms timestamp's wall-clock time to the nearest 15-min slot
 *  (rounding down) and return as "HH:mm". */
export function msToTimeSlot(ms: number): string {
  const d = new Date(ms);
  const minutes = Math.floor(d.getMinutes() / 15) * 15;
  return `${String(d.getHours()).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Lossless ms → "HH:mm" preserving the exact minute. Used by edit-in-place
 *  so a 10:42 event round-trips losslessly through the picker. */
export function msToExactTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combine a wall-clock date + "HH:mm" time into a local-tz Date. */
export function combineDateAndTime(date: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const out = new Date(date);
  out.setHours(h ?? 0, m ?? 0, 0, 0);
  return out;
}

/** Pretty-print a "HH:mm" using the user's locale (12h/24h follows the OS). */
export function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "HH:mm" → minutes since 00:00. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Add `delta` minutes to a "HH:mm" time, wrapping at midnight. The wrap is
 *  intentional: the create form models cross-midnight events as
 *  `endTime <= startTime` rather than carrying a day component. */
export function addMinutes(time: string, delta: number): string {
  const total = (timeToMinutes(time) + delta + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Same-day duration label, e.g. "1 hr 15 min". Returns "" if end ≤ start. */
export function sameDayDuration(start: string, end: string): string {
  const minutes = timeToMinutes(end) - timeToMinutes(start);
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/**
 * Parse a free-typed time string into "HH:mm" (24-h). Mirrors Google
 * Calendar's permissive parser so users can type how they think:
 *
 *   "10"        → "10:00"
 *   "10am"      → "10:00"
 *   "10 PM"     → "22:00"
 *   "10:30"     → "10:30"
 *   "10:30 pm"  → "22:30"
 *   "10.30"     → "10:30"   (dot as separator)
 *   "1042"      → "10:42"   (compact 4-digit)
 *   "942"       → "09:42"   (compact 3-digit)
 *   "12:00 am"  → "00:00"
 *   "12 pm"     → "12:00"
 *
 * Returns `null` for invalid input. Callers should fall back to the
 * dropdown selection rather than guessing.
 */
export function parseTypedTime(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw === "") return null;

  // Detect am/pm suffix.
  let meridiem: "am" | "pm" | null = null;
  let body = raw;
  const meridiemMatch = body.match(/(am|pm|a|p)\s*$/);
  if (meridiemMatch) {
    const m = meridiemMatch[1];
    meridiem = m.startsWith("a") ? "am" : "pm";
    body = body.slice(0, body.length - meridiemMatch[0].length).trim();
  }

  let hours: number;
  let minutes: number;

  // "HH:mm" / "HH.mm" — explicit separator.
  const sepMatch = body.match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (sepMatch) {
    hours = Number(sepMatch[1]);
    minutes = Number(sepMatch[2]);
  } else if (/^\d+$/.test(body)) {
    if (body.length <= 2) {
      hours = Number(body);
      minutes = 0;
    } else if (body.length === 3) {
      hours = Number(body.slice(0, 1));
      minutes = Number(body.slice(1));
    } else if (body.length === 4) {
      hours = Number(body.slice(0, 2));
      minutes = Number(body.slice(2));
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "am") hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else {
    if (hours < 0 || hours > 23) return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
