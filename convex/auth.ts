import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { APP_NAME, EMAIL_DOMAIN } from "@shared/constants";
import { alphabet, generateRandomString } from "oslo/crypto";
import { Resend as ResendAPI } from "resend";

const ResendOTP = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  async generateVerificationToken() {
    return generateRandomString(8, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new ResendAPI(provider.apiKey);
    const { error } = await resend.emails.send({
      from: `My App <onboarding@${EMAIL_DOMAIN}>`,
      to: [email],
      subject: `Sign in to My App`,
      text: "Your code is " + token,
    });
 
    if (error) {
      throw new Error("Could not send");
    }
  },
});

const ResendOTPPasswordReset = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  async generateVerificationToken() {
    return generateRandomString(8, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new ResendAPI(provider.apiKey);
    const { error } = await resend.emails.send({
      from: `${APP_NAME} <noreply@${EMAIL_DOMAIN}>`,
      to: [email],
      subject: `Reset your password in ${APP_NAME}`,
      text: "Your password reset code is " + token,
    });
 
    if (error) {
      throw new Error("Could not send");
    }
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
    Password({ reset: ResendOTPPasswordReset, verify: ResendOTP })
  ],
});

 
