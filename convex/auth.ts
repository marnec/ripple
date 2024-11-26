import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./otp";
import { ResendOTPPasswordReset } from "./passwordReset";

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
    Resend({ from: "noreply@email.conduits.space" }),
    Password({ reset: ResendOTPPasswordReset, verify: ResendOTP }),
  ],
});
