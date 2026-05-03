import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuthActions } from "@convex-dev/auth/react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { PasswordReset } from "./PasswordReset";
import { EmailVerification } from "./EmailVerification";

type Step = "auth" | "linkSent" | { email: string };
type Flow = "signIn" | "signUp" | "forgot";

export function SignInForm() {
  const [step, setStep] = useState<Step>("auth");

  if (step === "linkSent") {
    return <LinkSentStep onBack={() => setStep("auth")} />;
  }
  if (typeof step === "object") {
    return <EmailVerification email={step.email} />;
  }
  return <AuthCard setStep={setStep} />;
}

function AuthCard({ setStep }: { setStep: (s: Step) => void }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<Flow>("signIn");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (flow === "forgot") {
    return <PasswordReset handleCancel={() => setFlow("signIn")} />;
  }

  const isSignUp = flow === "signUp";

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          {isSignUp
            ? "Get started with your Ripple workspace."
            : "Sign in to your Ripple workspace."}
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-11 bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
        onClick={() => void signIn("github")}
      >
        <GitHubLogoIcon className="mr-2 size-4" />
        Continue with GitHub
      </Button>

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

      <form
        onSubmit={(e) => void handlePasswordSubmit(e)}
        className="flex flex-col gap-4"
      >
        <div className="space-y-2">
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
            className="h-11 bg-white/5 border-white/15 text-white placeholder:text-white/35 focus-visible:border-white/40 focus-visible:ring-white/20"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-2">
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

        <Button
          type="submit"
          disabled={submitting}
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
          onClick={() => setFlow(isSignUp ? "signIn" : "signUp")}
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
