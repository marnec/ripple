import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuthActions } from "@convex-dev/auth/react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { GitlabMark } from "@/components/GitlabMark";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { PasswordReset } from "./PasswordReset";
import { EmailVerification } from "./EmailVerification";

type Step = "auth" | "linkSent" | { email: string };
type Flow = "signIn" | "signUp" | "forgot";

type SignInFormProps = {
  /** When set, the email is pre-filled and locked (e.g. arriving via an invite). */
  lockedEmail?: string;
  /** Which flow to show first. Defaults to "signIn". */
  defaultFlow?: Flow;
  /**
   * Hide the GitHub/GitLab buttons. Used on invite pages: an OAuth account's
   * email is only known after the round-trip and may not match the invited
   * email, leaving the user with an orphan account that can't accept the
   * invite. Forcing email/password (locked to the invited email) guarantees a
   * match; OAuth can still be linked later by signing in with the same email.
   */
  hideOAuth?: boolean;
};

// Persist a pending email-verification step so a page reload returns the user
// to the code-entry screen instead of dropping them back on sign-up. Without
// this, re-registering generates a *new* code that invalidates the one already
// emailed, leaving two codes in the inbox where only the newest verifies.
const PENDING_VERIFICATION_KEY = "ripple:pending-email-verification";

function loadPersistedStep(lockedEmail?: string): Step | null {
  try {
    const raw = sessionStorage.getItem(PENDING_VERIFICATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown };
    if (typeof parsed.email !== "string") return null;
    // Ignore a stale verification for a different (invite-locked) email.
    if (lockedEmail && parsed.email !== lockedEmail) return null;
    return { email: parsed.email };
  } catch {
    return null;
  }
}

function persistStep(step: Step) {
  try {
    if (typeof step === "object") {
      sessionStorage.setItem(
        PENDING_VERIFICATION_KEY,
        JSON.stringify({ email: step.email }),
      );
    } else {
      sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
    }
  } catch {
    // Ignore storage failures (private mode, quota) — persistence is best-effort.
  }
}

export function SignInForm({
  lockedEmail,
  defaultFlow = "signIn",
  hideOAuth = false,
}: SignInFormProps = {}) {
  const [step, setStepState] = useState<Step>(() => loadPersistedStep(lockedEmail) ?? "auth");

  const setStep = (next: Step) => {
    persistStep(next);
    setStepState(next);
  };

  if (step === "linkSent") {
    return <LinkSentStep onBack={() => setStep("auth")} />;
  }
  if (typeof step === "object") {
    return (
      <EmailVerification
        email={step.email}
        onBack={() => setStep("auth")}
        onVerified={() => persistStep("auth")}
      />
    );
  }
  return (
    <AuthCard
      setStep={setStep}
      lockedEmail={lockedEmail}
      defaultFlow={defaultFlow}
      hideOAuth={hideOAuth}
    />
  );
}

function AuthCard({
  setStep,
  lockedEmail,
  defaultFlow,
  hideOAuth,
}: {
  setStep: (s: Step) => void;
  lockedEmail?: string;
  defaultFlow: Flow;
  hideOAuth: boolean;
}) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<Flow>(defaultFlow);
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (flow === "forgot") {
    return <PasswordReset handleCancel={() => setFlow("signIn")} />;
  }

  const isSignUp = flow === "signUp";
  const passwordsMismatch =
    isSignUp && confirmPassword.length > 0 && password !== confirmPassword;

  const switchFlow = (next: Flow) => {
    setFlow(next);
    setConfirmPassword("");
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (isSignUp && password !== confirmPassword) {
      toast.error("Passwords do not match", {
        description: "Re-enter the same password in both fields.",
      });
      return;
    }
    setSubmitting(true);
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    formData.set("flow", isSignUp ? "signUp" : "signIn");
    try {
      const { signingIn } = await signIn("password", formData);
      if (!signingIn) {
        setStep({ email: formData.get("email") as string });
      }
    } catch {
      toast.error(isSignUp ? "Could not create account" : "Sign in failed", {
        description: isSignUp
          ? "Try a different email or sign in instead"
          : "Wrong email or password",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      toast.error("Enter your email first");
      return;
    }
    const formData = new FormData();
    formData.set("email", email);
    try {
      await signIn("resend", formData);
      setStep("linkSent");
    } catch (error) {
      toast.error("Could not send sign-in link", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 short:gap-3 sm:gap-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          {isSignUp
            ? "Get started with your Ripple workspace."
            : "Sign in to your Ripple workspace."}
        </p>
      </div>

      {!hideOAuth && (
        <>
          {/* Two peer options, so they sit side by side and read as a pair.
              They only stretch to full width from `sm:` up, where the row would
              otherwise leave two stubby buttons stranded in a wide column. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-1 sm:gap-4">
            <Button
              type="button"
              variant="outline"
              aria-label="Continue with GitHub"
              className="h-11 bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
              onClick={() => void signIn("github")}
            >
              <GitHubLogoIcon className="mr-2 size-4" />
              <span className="sm:hidden">GitHub</span>
              <span className="hidden sm:inline">Continue with GitHub</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              aria-label="Continue with GitLab"
              className="h-11 bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
              onClick={() => void signIn("gitlab")}
            >
              <GitlabMark className="mr-2 size-4" />
              <span className="sm:hidden">GitLab</span>
              <span className="hidden sm:inline">Continue with GitLab</span>
            </Button>
          </div>

          <div className="relative" aria-hidden="true">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/15" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-black px-3 text-white/45 tracking-wider uppercase">
                or
              </span>
            </div>
          </div>
        </>
      )}

      <form
        onSubmit={(e) => void handlePasswordSubmit(e)}
        className="flex flex-col gap-4 short:gap-3"
      >
        <div className="space-y-2 short:space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            name="email"
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!!lockedEmail}
            aria-readonly={!!lockedEmail}
            className={
              "h-11 bg-white/5 border-white/15 text-white placeholder:text-white/35 focus-visible:border-white/40 focus-visible:ring-white/20" +
              (lockedEmail ? " cursor-not-allowed text-white/70 focus-visible:ring-0" : "")
            }
            autoComplete="email"
            required
          />
          {lockedEmail && (
            <p className="text-xs text-white/45">
              This invitation is tied to this email address.
            </p>
          )}
        </div>

        <div className="space-y-2 short:space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            {!isSignUp && (
              <button
                type="button"
                className="text-xs text-white/55 hover:text-white underline-offset-4 hover:underline"
                onClick={() => setFlow("forgot")}
              >
                Forgot password?
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              name="password"
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder={isSignUp ? "At least 8 characters" : "Your password"}
              minLength={isSignUp ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 bg-white/5 border-white/15 text-white placeholder:text-white/35 pr-10 focus-visible:border-white/40 focus-visible:ring-white/20"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 hover:text-white"
            >
              {showPassword ? (
                <EyeOffIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
            </button>
          </div>
        </div>

        {isSignUp && (
          <div className="space-y-2 short:space-y-1">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm password
            </label>
            <Input
              name="confirmPassword"
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={
                "h-11 bg-white/5 border-white/15 text-white placeholder:text-white/35 focus-visible:border-white/40 focus-visible:ring-white/20" +
                (passwordsMismatch
                  ? " border-destructive/70 focus-visible:border-destructive/70 focus-visible:ring-destructive/30"
                  : "")
              }
              autoComplete="new-password"
              aria-invalid={passwordsMismatch}
              required
            />
            {passwordsMismatch && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>
        )}

        <Button
          type="submit"
          disabled={submitting || passwordsMismatch}
          className="h-11 bg-white text-black hover:bg-white/90 font-medium"
        >
          {submitting
            ? isSignUp
              ? "Creating account…"
              : "Signing in…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <button
        type="button"
        className="text-xs text-white/55 hover:text-white text-center underline-offset-4 hover:underline"
        onClick={() => void handleMagicLink()}
      >
        Email me a sign-in link instead
      </button>

      <p className="text-center text-sm text-white/55">
        {isSignUp ? "Already have an account?" : "New to Ripple?"}{" "}
        <button
          type="button"
          className="font-medium text-white underline underline-offset-4 cursor-pointer"
          onClick={() => switchFlow(isSignUp ? "signIn" : "signUp")}
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}

function LinkSentStep({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center text-center py-4">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-white/8 ring-1 ring-white/15">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="20" height="16" x="2" y="4" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
      <p className="mt-2 text-sm text-white/60">
        We sent a sign-in link to your inbox. Click it to continue.
      </p>
      <Button
        className="mt-6 text-white hover:bg-white/10 hover:text-white"
        variant="ghost"
        onClick={onBack}
      >
        Back to sign in
      </Button>
    </div>
  );
}
