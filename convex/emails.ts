"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";
import { Resend } from "resend";
import { APP_NAME, EMAIL_DOMAIN } from "@shared/constants"

export const sendWorkspaceInvite = internalAction({
  args: {
    inviteId: v.id("workspaceInvites"),
    workspaceName: v.string(),
    inviterName: v.string(),
    recipientEmail: v.string(),
  },
  handler: async (_, { inviteId, workspaceName, inviterName, recipientEmail }) => {
    const url = `${process.env.SITE_URL}/invite/${inviteId}`;

    const emailContent = `<!DOCTYPE html>
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
            <strong>${inviterName}</strong> invited you to join <strong>${workspaceName}</strong>.
          </p>
          <p style="margin:0 0 28px;font-size:14px;color:#52525b;line-height:1.5;">
            Accept the invitation to start collaborating.
          </p>
          <a href="${url}" style="display:inline-block;padding:10px 28px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
            Accept Invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
            Or copy this link: <a href="${url}" style="color:#71717a;">${url}</a>
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

    const resendKey = process.env.AUTH_RESEND_KEY;

    if (!resendKey) {
      throw new ConvexError("Missing Resend API key");
    }

    const resend = new Resend(resendKey);

    return resend.emails.send({
      from: `${APP_NAME} <noreply@${EMAIL_DOMAIN}>`,
      to: recipientEmail,
      subject: `Invitation to join ${workspaceName} on ${APP_NAME}`,
      html: emailContent,
    })
      .then((sent) => {
        if (sent.error) {
          throw new ConvexError(`Failed to send email: ${sent.error.message}`);
        }
        return sent;
      })
      .catch((error) => {
        console.error("Failed to send email:", error);
        throw error;
      });
  },
}); 