// Shared types used by parser/auth/convex/worker. Kept dependency-free so
// the unit tests can import without pulling Cloudflare globals.

export type Partstat = "ACCEPTED" | "DECLINED" | "TENTATIVE";

export interface ParsedRsvp {
  /** RFC 5545 UID, echoed unchanged from the original invite. Built by
   *  apps/convex/convex/emails.ts `eventUid()` as `${eventId}@${RSVP_DOMAIN}`. */
  uid: string;
  /** Lowercased mailto: from the ICS ATTENDEE property. */
  attendeeEmail: string;
  partstat: Partstat;
  /** RFC 5545 DTSTAMP converted to ms-since-epoch. */
  dtstamp: number;
  /** RFC 5545 SEQUENCE; defaults to 0 when absent (Outlook drops it on REPLY). */
  sequence: number;
}

export interface AuthResult {
  ok: boolean;
  reason?:
    | "no_auth_results"
    | "dkim_fail"
    | "dmarc_fail"
    | "from_mismatch"
    | "no_envelope_from";
  /** Domain used for the From-vs-attendee comparison. */
  fromDomain: string | null;
}

export interface AuthVerdict {
  dkim: "pass" | "fail" | "none";
  dmarc: "pass" | "fail" | "none";
}

/** Cloudflare Worker bindings — see wrangler.jsonc + `wrangler secret put`. */
export interface Env {
  RSVP_WORKER_SECRET: string;
  CONVEX_HTTP_URL: string;
  /** Inbound RSVP domain — must match `EMAIL_RSVP_DOMAIN` in
   *  packages/shared/src/constants.ts (the apex domain whose MX records
   *  forward to this Worker). Distinct from the Resend-verified `from:`
   *  domain (`EMAIL_FROM_DOMAIN`), which the worker never sees. */
  RSVP_DOMAIN: string;
}
