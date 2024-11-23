import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { convexAuth } from "@convex-dev/auth/server";

export const { 
  auth, 
  signIn, 
  signOut, 
  store 
}: {
  auth: any;
  signIn: any;
  signOut: any;
  store: any;
} = convexAuth({
  providers: [GitHub, Resend({ from: "noreply@email.conduits.space" })],
});
