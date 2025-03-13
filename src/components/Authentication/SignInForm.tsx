import { SignInMethodDivider } from "@/components/SignInMethodDivider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/toaster";
import { toast, useToast } from "@/components/ui/use-toast";
import { useAuthActions } from "@convex-dev/auth/react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordReset } from "./PasswordReset";
import { EmailVerification } from "./EmailVerification";

export function SignInForm() {
  const [step, setStep] = useState<"signIn" | "linkSent" | { email: string }>("signIn");

  return (
    <div className="container my-auto">
      <div className="max-w-[384px] mx-auto flex flex-col my-auto gap-4 pb-8">
        {step === "signIn" ? (
          <SignInStep setStep={setStep} />
        ) : step === "linkSent" ? (
          <LinkSentStep setStep={setStep} />
        ) : (
          <EmailVerification email={step.email} />
        )}
      </div>
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
      <h1 className="text-2xl font-bold">Login to your account</h1>
      <p className="text-balance text-sm text-muted-foreground">
        Enter your email below to login to your account
      </p>
      <Tabs defaultValue="password">
        <TabsList>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <SignInWithPassword setStep={setStep} />
        </TabsContent>
        <TabsContent value="magic-link">
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
    <>
      <h2 className="font-semibold text-2xl tracking-tight">Check your email</h2>
      <p>A sign-in link has been sent to your email address.</p>
      <Button className="p-0 self-start" variant="link" onClick={() => setStep("signIn")}>
        Cancel
      </Button>
    </>
  );
}

function SignInWithGitHub() {
  const { signIn } = useAuthActions();
  return (
    <Button
      className="flex-1 w-full"
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
  const { toast } = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await signIn("resend", formData);
      handleLinkSent();
    } catch (error) {
      toast({
        title: `Could not send sign-in link ${error}`,
        variant: "destructive",
      });
    }
  };

  return (
    <form className="flex flex-col" onSubmit={handleSubmit}>
      <label htmlFor="email">Email</label>
      <Input name="email" id="email" className="mb-4" autoComplete="email" required />
      <Button type="submit">Send sign-in link</Button>
      <Toaster />
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
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Authentication failed",
        description: "Wrong email or password",
      });
    }
  };

  return (
    <>
      {flow !== "forgot" ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <input name="flow" type="hidden" value={flow} />
          <div>
            <label htmlFor="email">Email</label>
            <Input name="email" type="text" autoComplete="email" required />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password">Password</label>
              {flow === "signIn" && (
                <Button
                  type="button"
                  variant="link"
                  className="p-0 h-auto"
                  onClick={() => setFlow("forgot")}
                >
                  Forgot your password?
                </Button>
              )}
            </div>
            <Input name="password" type="password" required />
          </div>

          <Button type="submit" className="w-full">
            {flow === "signIn" ? "Sign in" : "Sign up"}
          </Button>
          <SignInMethodDivider />
          <SignInWithGitHub />
          <div className="text-center">
            <span>Don't have an account? </span>
            <a
              href="#"
              className="underline underline-offset-4"
              onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
            >
              Sign {flow === "signIn" ? "up" : "in"}
            </a>
          </div>
        </form>
      ) : (
        <PasswordReset handleCancel={() => setFlow("signIn")} />
      )}
    </>
  );
}
