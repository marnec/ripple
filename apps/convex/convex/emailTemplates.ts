/**
 * Email bodies and the escape they all depend on, in a plain (non-`"use node"`)
 * module so a *mutation* can render one.
 *
 * That constraint is the whole reason this file exists: `emails.ts` is
 * `"use node"` (it constructs the Resend SDK client), and a non-node module
 * cannot import a node one. Routing invite mail through `@convex-dev/resend`
 * means the enqueue happens in the mutation that created the invite — so the
 * body has to be renderable from there.
 *
 * `emails.ts` imports `escapeHtml` from here rather than keeping its own copy,
 * so the invariant it documents ("every value interpolated into an HTML string
 * goes through this") stays a single grep across both senders.
 */

import { APP_NAME } from "@ripple/shared/constants";

/**
 * Escape a value for interpolation into the HTML body. The sibling of
 * `icsEscapeText` in `emails.ts`, which handles the same concern for the
 * calendar attachment — every value these emails carry crosses both contexts,
 * and only one of them had an escape.
 *
 * The rule this file keeps: **every** value interpolated into an HTML string
 * goes through this, including server-constructed URLs that are safe today —
 * so the invariant is a grep rather than a per-value argument about who can
 * reach it. Two deliberate exceptions: `APP_NAME` and the `subhead`/`bodyHtml`
 * a caller passes to `renderEventEmailLayout`, which are markup by design.
 *
 * Applies to HTML only. `subject` is plain text: escaping it would show
 * `&amp;` to the recipient rather than hide markup from them.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subject line — plain text, deliberately unescaped. See `escapeHtml`. */
export function workspaceInviteSubject(workspaceName: string): string {
  return `Invitation to join ${workspaceName} on ${APP_NAME}`;
}

export function renderWorkspaceInviteEmail(opts: {
  inviterName: string;
  workspaceName: string;
  url: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#18181b;">${APP_NAME}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#71717a;">Workspace Invitation</p>
          <p style="margin:0 0 8px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${escapeHtml(opts.inviterName)}</strong> invited you to join <strong>${escapeHtml(opts.workspaceName)}</strong>.
          </p>
          <p style="margin:0 0 28px;font-size:14px;color:#52525b;line-height:1.5;">
            Accept the invitation to start collaborating.
          </p>
          <a href="${escapeHtml(opts.url)}" style="display:inline-block;padding:10px 28px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
            Accept Invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
            Or copy this link: <a href="${escapeHtml(opts.url)}" style="color:#71717a;">${escapeHtml(opts.url)}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f4f4f5;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">
            If you didn't expect this invitation, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
