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


/**
 * How many non-DM channels (`open` + `closed`) one workspace may hold.
 *
 * DMs are deliberately NOT counted. A DM is not something a person chooses to
 * create out of a budget — the number of possible DMs grows with the square of
 * the member count, so counting them would let a workspace of 20 people
 * exhaust the allowance without anyone creating a single channel, and the
 * failure would land on "message a colleague". `channels.listHostable` already
 * uses "open + closed, excluding DMs" as the meaning of *channel* in a
 * user-facing surface.
 *
 * The cap also bounds the `users` trigger: a rename patches one
 * `channelMembers` row per channel the user belongs to, in the originating
 * transaction. Per workspace that fan-out is now at most this many rows plus
 * the user's DMs (itself bounded by the member count).
 */
export const WORKSPACE_CHANNEL_LIMIT = 150;

/**
 * How long a user must wait between display-name changes.
 *
 * A rename fans out to every `channelMembers` row the user holds, plus their
 * `nodes` row, inside the renaming transaction. The cooldown is what keeps
 * that from being a repeatable cost.
 */
export const NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** When the user may next change their display name; null if they may now. */
export function nameChangeAvailableAt(
  nameChangedAt: number | undefined,
  now: number = Date.now(),
): number | null {
  if (nameChangedAt === undefined) return null;
  const availableAt = nameChangedAt + NAME_CHANGE_COOLDOWN_MS;
  return availableAt > now ? availableAt : null;
}

/** True when the user is outside the cooldown and may change their name. */
export function canChangeName(
  nameChangedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  return nameChangeAvailableAt(nameChangedAt, now) === null;
}

/**
 * Ceiling on a chat file attachment, enforced in `medias.saveMedia` against
 * the size the *storage system* reports rather than the client's claim.
 *
 * Only `type: "file"` is capped. An `image` upload goes through
 * `generateThumbnail` first, so what lands in a message body is a bounded
 * derivative; capping the original too would start rejecting camera-sized
 * photos that work today, which is a separate decision from "how big may an
 * arbitrary blob be".
 */
export const MESSAGE_FILE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Human-readable byte size — "0 B", "14 KB", "2.3 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // Bytes and kilobytes are noise below the decimal point; megabytes up are not.
  const rounded = unit >= 2 && value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} ${units[unit]}`;
}
