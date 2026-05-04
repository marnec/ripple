export const APP_NAME = "Ripple";
export const EMAIL_DOMAIN = "email.conduits.space";
export const DEFAULT_DOC_NAME = `Doc`;
export const DEFAULT_DIAGRAM_NAME = `Draw`;
export const DEFAULT_SPREADSHEET_NAME = `Sheet`;

export const MESSAGE_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isMessageEditable(creationTime: number, now: number = Date.now()): boolean {
  return now - creationTime < MESSAGE_EDIT_WINDOW_MS;
}

