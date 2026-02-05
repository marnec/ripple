import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { APP_NAME, EMAIL_DOMAIN } from "@shared/constants";
import { ConvexError } from "convex/values";
import { alphabet, generateRandomString } from "oslo/crypto";

// Helper to send emails via Resend API using fetch (avoids Node-only dependencies)
async function sendResendEmail(
  apiKey: string,
  from: string,
  to: string[],
  subject: string,
  text: string
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new ConvexError(`Could not send email: ${error.message || response.statusText}`);
  }

  return response.json();
}

const ResendOTP = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  async generateVerificationToken() {
    return generateRandomString(8, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    if (!provider.apiKey) {
      throw new ConvexError("Missing Resend API key");
    }
    await sendResendEmail(
      provider.apiKey,
      `My ${APP_NAME} <onboarding@${EMAIL_DOMAIN}>`,
      [email],
      `Sign in to ${APP_NAME}`,
      "Your code is " + token
    );
  },
});

const ResendOTPPasswordReset = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  async generateVerificationToken() {
    return generateRandomString(8, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    if (!provider.apiKey) {
      throw new ConvexError("Missing Resend API key");
    }
    await sendResendEmail(
      provider.apiKey,
      `${APP_NAME} <noreply@${EMAIL_DOMAIN}>`,
      [email],
      `Reset your password in ${APP_NAME}`,
      "Your password reset code is " + token
    );
  },
});

export const {
  auth,
  signIn,
  signOut,
  store,
}: {
  auth: any;
  signIn: any;
  signOut: any;
  store: any;
} = convexAuth({
  providers: [
    GitHub,
    Resend({ from: `${APP_NAME} <noreply@${EMAIL_DOMAIN}>` }),
    Password({ reset: ResendOTPPasswordReset, verify: ResendOTP }),
  ],
});
