// Bearer-secret POST to /calendar/rsvp on the Convex HTTP deployment.
// Mirrors the auth pattern used by partykit -> Convex (see
// apps/convex/convex/http.ts /collaboration/* routes).

import type { Env, ParsedRsvp } from "./types";

export interface RsvpAck {
  ok: boolean;
  applied?: boolean;
  reason?:
    | "stale"
    | "unknown_event"
    | "unknown_attendee"
    | "event_cancelled";
}

export async function postRsvp(env: Env, body: ParsedRsvp): Promise<RsvpAck> {
  const res = await fetch(`${env.CONVEX_HTTP_URL}/calendar/rsvp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RSVP_WORKER_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`convex /calendar/rsvp ${res.status}`);
  }
  return (await res.json()) as RsvpAck;
}
