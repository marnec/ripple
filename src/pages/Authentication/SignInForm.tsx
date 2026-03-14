import { SignInMethodDivider } from "@/pages/Authentication/SignInMethodDivider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuthActions } from "@convex-dev/auth/react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordReset } from "./PasswordReset";
import { EmailVerification } from "./EmailVerification";

export function SignInForm() {
  const [step, setStep] = useState<"signIn" | "linkSent" | { email: string }>("signIn");

  return (
    <div className="flex flex-col gap-4">
      {step === "signIn" ? (
        <SignInStep setStep={setStep} />
      ) : step === "linkSent" ? (
        <LinkSentStep setStep={setStep} />
      ) : (
        <EmailVerification email={step.email} />
      )}
    </div>
  );
}

function SignInStep({
  setStep,
}: {
  setStep: React.Dispatch<React.SetStateAction<"signIn" | "linkSent" | { email: string }>>;
}) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to your account to continue
        </p>
      </div>
      <Tabs defaultValue="password" className="mt-2">
        <TabsList className="w-full">
          <TabsTrigger value="password" className="flex-1">Password</TabsTrigger>
          <TabsTrigger value="magic-link" className="flex-1">Magic Link</TabsTrigger>
        </TabsList>
        <TabsContent value="password" className="mt-4">
          <SignInWithPassword setStep={setStep} />
        </TabsContent>
        <TabsContent value="magic-link" className="mt-4">
          <SignInWithMagicLink handleLinkSent={() => setStep("linkSent")} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LinkSentStep({
  setStep,
}: {
  setStep: React.Dispatch<React.SetStateAction<"signIn" | "linkSent" | { email: string }>>;
}) {
  return (
    <div className="text-center py-4">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="20" height="16" x="2" y="4" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A sign-in link has been sent to your email address.
      </p>
      <Button
        className="mt-6"
        variant="ghost"
        onClick={() => setStep("signIn")}
      >
        Back to sign in
      </Button>
    </div>
  );
}

function SignInWithGitHub() {
  const { signIn } = useAuthActions();
  return (
    <Button
      className="w-full h-11"
      variant="outline"
      type="button"
      onClick={() => void signIn("github")}
    >
      <GitHubLogoIcon className="mr-2 h-4 w-4" /> GitHub
    </Button>
  );
}

function SignInWithMagicLink({ handleLinkSent }: { handleLinkSent: () => void }) {
  const { signIn } = useAuthActions();
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await signIn("resend", formData);
      handleLinkSent();
    } catch (error) {
      toast.error(`Could not send sign-in link ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
      <div className="space-y-2">
        <label htmlFor="magic-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          name="email"
          id="magic-email"
          type="email"
          placeholder="you@example.com"
          className="h-11"
          autoComplete="email"
          required
        />
      </div>
      <Button type="submit" className="h-11">
        Send sign-in link
      </Button>
    </form>
  );
}

function SignInWithPassword({
  setStep,
}: {
  setStep: React.Dispatch<React.SetStateAction<"signIn" | "linkSent" | { email: string }>>;
}) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signUp" | "signIn" | "forgot">("signIn");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const { signingIn } = await signIn("password", formData);
      if (!signingIn) {
        setStep({ email: formData.get("email") as string });
      }
    } catch {
      toast.error("Authentication failed", {
        description: "Wrong email or password",
      });
    }
  };

  return (
    <>
      {flow !== "forgot" ? (
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
          <input name="flow" type="hidden" value={flow} />
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              name="email"
              id="email"
              type="text"
              placeholder="you@example.com"
              className="h-11"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              {flow === "signIn" && (
                <Button
                  type="button"
                  variant="link"
                  className="p-0 h-auto text-xs text-muted-foreground"
                  onClick={() => setFlow("forgot")}
                >
                  Forgot password?
                </Button>
              )}
            </div>
            <Input
              name="password"
              id="password"
              type="password"
              className="h-11"
              required
            />
          </div>

          <Button type="submit" className="w-full h-11">
            {flow === "signIn" ? "Sign in" : "Create account"}
          </Button>
          <SignInMethodDivider />
          <SignInWithGitHub />
          <p className="text-center text-sm text-muted-foreground">
            {flow === "signIn" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
              onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
            >
              {flow === "signIn" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </form>
      ) : (
        <PasswordReset handleCancel={() => setFlow("signIn")} />
      )}
    </>
  );
}
