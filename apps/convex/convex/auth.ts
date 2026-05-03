import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { APP_NAME, EMAIL_DOMAIN } from "@ripple/shared/constants";
import { ConvexError } from "convex/values";
import { alphabet, generateRandomString } from "oslo/crypto";
import type { QueryCtx } from "./_generated/server";

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

/**
 * Find a unique user with a verified email. Mirrors Convex Auth's internal
 * helper — used for account linking in `createOrUpdateUser` below.
 */
async function findVerifiedEmailUser(ctx: QueryCtx, email: string) {
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .filter((q) => q.neq(q.field("emailVerificationTime"), undefined))
    .take(2);
  return users.length === 1 ? users[0] : null;
}

async function findVerifiedPhoneUser(ctx: QueryCtx, phone: string) {
  const users = await ctx.db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", phone))
    .filter((q) => q.neq(q.field("phoneVerificationTime"), undefined))
    .take(2);
  return users.length === 1 ? users[0] : null;
}

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    GitHub,
    Resend({ from: `${APP_NAME} <noreply@${EMAIL_DOMAIN}>` }),
    Password({ reset: ResendOTPPasswordReset, verify: ResendOTP }),
  ],
  callbacks: {
    /**
     * Replaces Convex Auth's default create-or-update-user flow with one
     * tweak: if the user row we're updating (existing user or the target of
     * email/phone linking) already has a `name` set, we strip `name` from
     * the incoming profile so that connecting a new provider (e.g. GitHub
     * after a manual rename, or a second SSO account) can't overwrite it.
     *
     * Everything else — email/phone verification, linking, new user creation
     * — matches the default behavior from `convex-auth/src/server/implementation/users.ts`.
     */
    async createOrUpdateUser(ctx, args) {
      const {
        provider,
        profile: {
          emailVerified: profileEmailVerified,
          phoneVerified: profilePhoneVerified,
          ...profile
        },
        existingUserId,
      } = args;

      const emailVerified =
        profileEmailVerified ??
        ((provider.type === "oauth" || provider.type === "oidc") &&
          provider.allowDangerousEmailAccountLinking !== false);
      const phoneVerified = profilePhoneVerified ?? false;
      const shouldLink = args.shouldLink ?? false;
      const shouldLinkViaEmail =
        shouldLink || emailVerified || provider.type === "email";
      const shouldLinkViaPhone =
        shouldLink || phoneVerified || provider.type === "phone";

      let userId = existingUserId;
      if (existingUserId === null) {
        const linkedByEmailId =
          typeof profile.email === "string" && shouldLinkViaEmail
            ? (await findVerifiedEmailUser(ctx, profile.email))?._id ?? null
            : null;
        const linkedByPhoneId =
          typeof profile.phone === "string" && shouldLinkViaPhone
            ? (await findVerifiedPhoneUser(ctx, profile.phone))?._id ?? null
            : null;

        if (linkedByEmailId !== null && linkedByPhoneId !== null) {
          userId = null; // ambiguous — don't link
        } else if (linkedByEmailId !== null) {
          userId = linkedByEmailId;
        } else if (linkedByPhoneId !== null) {
          userId = linkedByPhoneId;
        }
      }

      const userData: Record<string, unknown> = {
        ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
        ...(phoneVerified ? { phoneVerificationTime: Date.now() } : null),
        ...profile,
      };

      if (userId !== null) {
        // Preserve an already-set name across provider refreshes and
        // account linking. Applies whether the name was manually set via
        // users.update or originally filled in by a previous provider.
        const existingUser = await ctx.db.get(userId);
        if (existingUser?.name && "name" in userData) {
          delete userData.name;
        }
        await ctx.db.patch(userId, userData);
        return userId;
      }

      return await ctx.db.insert("users", userData);
    },
  },
});
