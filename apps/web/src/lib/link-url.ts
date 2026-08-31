/**
 * Schemes a link in a message or document is allowed to point at.
 *
 * `javascript:` and `data:` are the reason this is an allowlist rather than a
 * denylist: message bodies are stored as JSON and rendered as anchors, so an
 * href that survives to the DOM is script the sender gets to run in our origin.
 */
const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

/**
 * Leading characters that make an href resolve against the *current page*:
 * a path (`/x`, `./x`, `../x`), a scheme-relative host (`//x`), a query or a
 * fragment.
 *
 * Relative links are not a supported feature. An `<a href="acme">` inside a
 * chat message resolves against whatever route the reader happens to be on, so
 * a link the author meant for the outside world silently becomes an in-app URL
 * with no page behind it. Every link Ripple emits or renders is absolute.
 */
const RELATIVE_PREFIX = /^[/\\?#]|^\.\.?(?:[/\\]|$)/;

/** A `scheme:` prefix, with capture 2 set when it is followed by `//`. */
const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):(\/\/)?/i;

/**
 * Turn user-supplied link input into an absolute, safe href — or `null` when it
 * cannot be one.
 *
 * A bare `example.com` (or anything else without a scheme) is assumed to be
 * `https://`, the way every chat app does it; that is what keeps a typo'd URL
 * from becoming a relative link. Explicitly relative input is rejected instead
 * of guessed at, since prefixing `https://` onto `/settings` would only produce
 * a different wrong link.
 *
 * Used on both ends: when a link is created in the composer, and again when a
 * stored message is rendered — messages written before this existed (and any
 * body a client crafts by hand) still carry unvalidated hrefs.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || RELATIVE_PREFIX.test(trimmed)) return null;

  const scheme = SCHEME_PREFIX.exec(trimmed);
  let candidate: string;
  if (scheme && ALLOWED_PROTOCOLS.includes(scheme[1].toLowerCase() + ":")) {
    candidate = trimmed;
  } else if (scheme?.[2]) {
    // An explicit foreign scheme (`ftp://`, `file://`, `chrome://`). Prefixing
    // `https://` onto it would invent a destination the author never typed.
    return null;
  } else {
    // No scheme, or something that only looks like one — `example.com:8080`
    // matches SCHEME_PREFIX just as `javascript:alert(1)` does. Both go through
    // the parse below, which keeps the port and rejects the payload.
    candidate = `https://${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return null;
  // The parsed serialization rather than the input: it is the browser's own
  // escaping, so what we store is what the browser would have navigated to.
  return url.href;
}
