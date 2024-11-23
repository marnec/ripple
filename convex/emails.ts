import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { Resend } from "resend";

export const sendWorkspaceInvite = internalAction({
  args: {
    inviteId: v.id("workspaceInvites"),
    workspaceName: v.string(),
    inviterName: v.string(),
    recipientEmail: v.string(),
  },
  handler: async (_, { inviteId, workspaceName, inviterName, recipientEmail }) => {
    const url = `${process.env.SITE_URL}/invite/${inviteId}`;

    const emailContent = `
      Hi there!

      ${inviterName} has invited you to join the workspace "${workspaceName}" on Ripple.
      
      Click the link below to accept the invitation:
      ${url}

      If you didn't expect this invitation, you can safely ignore this email.

      Best regards,
      The Ripple Team
    `;

    const resendKey = process.env.AUTH_RESEND_KEY;

    if (!resendKey) {
      throw new Error("Missing Resend API key");
    }

    const resend = new Resend(resendKey);

    return resend.emails.send({
      from: "noreply@email.conduits.space",
      to: recipientEmail,
      subject: `Invitation to join ${workspaceName} on Ripple`,
      html: emailContent,
    })
      .then((sent) => {
        if (sent.error) {
          throw new Error(`Failed to send email: ${sent.error.message}`);
        }
        return sent;
      })
      .catch((error) => {
        console.error("Failed to send email:", error);
        throw error;
      });
  },
}); 