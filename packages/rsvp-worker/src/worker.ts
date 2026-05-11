// Cloudflare Email Worker entry point. Bound by an Email Routing rule on
// `rsvp@<RSVP_DOMAIN>` (configured manually in the Cloudflare dashboard).
//
// We intentionally swallow every error and never bounce — see auth.ts for
// the rationale. All observability goes through console.* (visible in
// `wrangler tail ripple-rsvp` and the dashboard logs).

import { parseRsvp } from "./parser";
import { verifyAuth } from "./auth";
import { postRsvp } from "./convex";
import type { Env } from "./types";

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    let parsed;
    try {
      parsed = await parseRsvp(message.raw);
    } catch (err) {
      console.warn("rsvp parse_error", { err: errorString(err) });
      return;
    }
    if (!parsed) {
      // Mail wasn't an ICS REPLY — could be a bounce, OOO, or someone
      // emailing rsvp@ directly. Drop silently.
      console.info("rsvp not_a_reply", { from: message.from });
      return;
    }

    const auth = verifyAuth(
      message.headers.get("Authentication-Results"),
      message.from,
      parsed.attendeeEmail,
    );
    if (!auth.ok) {
      console.warn("rsvp auth_fail", {
        reason: auth.reason,
        from: message.from,
        attendee: parsed.attendeeEmail,
      });
      return;
    }

    if (!parsed.uid.endsWith(`@${env.RSVP_DOMAIN}`)) {
      // Forwarded invite from a third-party calendar system whose UID
      // happens to land in our mailbox. Not ours; drop.
      console.info("rsvp foreign_uid", { uid: parsed.uid });
      return;
    }

    // Fire-and-forget Convex POST so we don't block the email runtime on
    // Convex latency. Cloudflare extends the worker lifetime to cover
    // waitUntil promises.
    ctx.waitUntil(
      postRsvp(env, parsed)
        .then((ack) => {
          console.info("rsvp applied", { uid: parsed.uid, ack });
        })
        .catch((err) => {
          console.error("rsvp convex_error", {
            err: errorString(err),
            uid: parsed.uid,
          });
        }),
    );
  },
} satisfies ExportedHandler<Env>;

function errorString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
