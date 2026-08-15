/**
 * Which push endpoints this deployment is willing to dial.
 *
 * A `pushSubscriptions.endpoint` is not data — it is a URL the notification
 * action later POSTs to, under this deployment's VAPID keys, once per
 * notification for as long as the row exists. `registerSubscription` is a
 * public mutation gated only on "someone is signed in", and signup is open, so
 * an unvalidated endpoint made any account an outbound-request primitive
 * pointed at a host of the caller's choosing. Nothing downstream re-validates,
 * and the sweep in `deliverToEndpoints` only removes endpoints that answer
 * 410/404/403 — a host that refuses the connection answers nothing, so the row
 * never ages out.
 *
 * The answer is an allowlist rather than a "looks safe" check, because a real
 * Push API endpoint is not user data at all: it is minted by the browser's own
 * push service, and there are four of those. Anything else is, by definition,
 * not a browser subscription — so blocking the private-network shapes (IP
 * literals, `localhost`, `*.internal`) would be answering a narrower question
 * than the one the code can actually answer.
 *
 * The cost is that a vendor host missing from this list reads as invalid and
 * that browser silently has no push. `deliverToEndpoints` therefore logs the
 * host it skipped, and this list is the one place to extend.
 */

/**
 * Exact hosts, and the parent domains whose subdomains count. Suffix entries
 * are matched as `.<suffix>` or the bare suffix — never as a raw `endsWith`,
 * which would accept `evil-fcm.googleapis.com` and
 * `fcm.googleapis.com.attacker.net`.
 */
const PUSH_SERVICE_HOSTS = [
  // Chrome, Edge, Opera, Brave, Vivaldi, Samsung Internet — all FCM.
  "fcm.googleapis.com",
  // Firefox: `updates.push.services.mozilla.com`, plus autopush shards.
  "push.services.mozilla.com",
  // Windows Notification Service: `wns2-*.notify.windows.com`.
  "notify.windows.com",
  // Safari / iOS web push.
  "web.push.apple.com",
];

/**
 * Generous next to a real endpoint (FCM's run ~200 chars) and still short
 * enough that the column cannot be used as storage.
 */
const MAX_ENDPOINT_LENGTH = 2048;

/**
 * Is this a URL one of the four push services could have issued?
 *
 * `https` only, length-capped, no credentials (`https://user:pass@host/` reads
 * as the host to `new URL` but not to every parser that might see it later),
 * and the host must be one of the services or a subdomain of one.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;

  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * The host, for a log line about an endpoint that was refused. The rest of the
 * URL is the subscription's bearer token — the host is the part an operator
 * needs and the only part safe to write down.
 */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "<unparseable>";
  }
}
