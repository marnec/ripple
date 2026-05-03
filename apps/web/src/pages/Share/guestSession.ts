/**
 * Per-tab guest session storage. `guestSub` identifies the guest to Yjs
 * awareness and Cloudflare RTK; `guestName` is the display name entered at
 * the landing page. Both live only for the browser tab lifetime.
 */

export interface GuestSession {
  guestSub: string;
  guestName: string;
}

export function buildGuestSessionKey(shareId: string): string {
  return `ripple.guestSession:${shareId}`;
}

export function loadGuestSession(shareId: string): GuestSession | null {
  try {
    const raw = window.sessionStorage.getItem(buildGuestSessionKey(shareId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestSession;
    if (typeof parsed.guestSub !== "string" || typeof parsed.guestName !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveGuestSession(shareId: string, session: GuestSession): void {
  window.sessionStorage.setItem(
    buildGuestSessionKey(shareId),
    JSON.stringify(session),
  );
}

export function clearGuestSession(shareId: string): void {
  window.sessionStorage.removeItem(buildGuestSessionKey(shareId));
}
