import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./otp";
import { ResendOTPPasswordReset } from "./passwordReset";
import { APP_NAME, EMAIL_DOMAIN } from "@shared/constants";

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
