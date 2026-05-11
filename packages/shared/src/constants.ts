export const APP_NAME = "Ripple";
// Outbound Resend sending domain — DKIM is verified here
// (`resend._domainkey.email.conduits.space`), so every `from:` we hand
// to Resend must live on this domain to keep DMARC alignment.
export const EMAIL_FROM_DOMAIN = "email.conduits.space";
// Inbound Cloudflare Email Routing domain — apex MX records forward
// mail to the ripple-rsvp Email Worker. Used for the ICS UID suffix
// and ORGANIZER mailto so RSVP replies land in a routable inbox.
// Distinct from EMAIL_FROM_DOMAIN because outbound (Resend) and
// inbound (Cloudflare) are wired to different providers; collapsing
// them would require either re-verifying Resend on the apex or
// adding subdomain MX records.
export const EMAIL_RSVP_DOMAIN = "conduits.space";
export const DEFAULT_DOC_NAME = `Doc`;
export const DEFAULT_DIAGRAM_NAME = `Draw`;
export const DEFAULT_SPREADSHEET_NAME = `Sheet`;

export const MESSAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isMessageEditable(creationTime: number, now: number = Date.now()): boolean {
  return now - creationTime < MESSAGE_EDIT_WINDOW_MS;
}

