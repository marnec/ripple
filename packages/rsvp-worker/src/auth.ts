// Authenticity gate for inbound ICS REPLYs.
//
// Without this, anyone with `rsvp@<domain>` and a guessable event UID could
// flip another invitee's status to DECLINED via a forged email. We defend
// against that by:
//
//   1. Trusting Cloudflare Email Routing's `Authentication-Results` header,
//      which records DKIM and DMARC verdicts the inbound MTA computed.
//      Cloudflare prepends a single line for every inbound message, so the
//      header is parseable; we ignore upstream Authentication-Results lines
//      (they're attacker-controlled — relays preserve them but never strip
//      them, and Cloudflare's own `mx.cloudflare.net;` line is always at the
//      top).
//   2. Requiring dkim=pass AND dmarc=pass (not OR — Gmail can SPF-pass while
//      DKIM-failing on third-party forwards, and we don't want those).
//   3. Requiring the SMTP envelope-From's domain to match the ATTENDEE
//      mailto's domain. Stops a holder of one verified mailbox from
//      accepting on behalf of another invitee.
//
// We never bounce: a bounce from `rsvp@…` would confirm to spammers that
// the address is live and discloses our domain configuration.

import type { AuthResult, AuthVerdict } from "./types";

/**
 * Parse a single Authentication-Results header value. Cloudflare's format is:
 *
 *   "Authentication-Results: mx.cloudflare.net;
 *      dkim=pass header.d=gmail.com header.s=20230601;
 *      spf=pass smtp.mailfrom=alice@gmail.com;
 *      dmarc=pass header.from=gmail.com"
 *
 * Method results may appear in any order; missing methods are reported as "none".
 */
export function parseAuthResults(header: string | null): AuthVerdict {
  if (!header) return { dkim: "none", dmarc: "none" };

  // Strip the authserv-id (everything up to the first ";") so we don't
  // mismatch a hostname like `dkim.cloudflare.net` against the dkim= token.
  const semi = header.indexOf(";");
  const tail = semi >= 0 ? header.slice(semi + 1) : header;

  const dkim = matchVerdict(tail, "dkim");
  const dmarc = matchVerdict(tail, "dmarc");
  return { dkim, dmarc };
}

function matchVerdict(s: string, method: string): "pass" | "fail" | "none" {
  // (^|[\s;])method=value — standalone token to avoid spf=pass matching dkim=pass.
  const re = new RegExp(`(?:^|[\\s;])${method}=([a-z]+)`, "i");
  const m = re.exec(s);
  if (!m) return "none";
  const v = m[1].toLowerCase();
  if (v === "pass") return "pass";
  if (v === "fail" || v === "permerror" || v === "temperror") return "fail";
  return "none";
}

/** Lowercased domain after `@`, or null if input is null/malformed. */
export function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Combined verdict: DKIM+DMARC pass AND envelope-From domain matches the
 * ATTENDEE domain. Caller should drop silently when ok=false.
 */
export function verifyAuth(
  authResultsHeader: string | null,
  envelopeFrom: string | null,
  attendeeEmail: string,
): AuthResult {
  const fromDomain = emailDomain(envelopeFrom);
  if (!fromDomain) {
    return { ok: false, reason: "no_envelope_from", fromDomain: null };
  }

  const verdict = parseAuthResults(authResultsHeader);
  if (verdict.dkim === "none" && verdict.dmarc === "none") {
    return { ok: false, reason: "no_auth_results", fromDomain };
  }
  if (verdict.dkim !== "pass") {
    return { ok: false, reason: "dkim_fail", fromDomain };
  }
  if (verdict.dmarc !== "pass") {
    return { ok: false, reason: "dmarc_fail", fromDomain };
  }

  const attendeeDomain = emailDomain(attendeeEmail);
  if (!attendeeDomain || attendeeDomain !== fromDomain) {
    return { ok: false, reason: "from_mismatch", fromDomain };
  }

  return { ok: true, fromDomain };
}
