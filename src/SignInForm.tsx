import { SignInMethodDivider } from "@/components/SignInMethodDivider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";
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
          <>
            <h2 className="font-semibold text-2xl tracking-tight">
              Sign in or create an account
            </h2>
            <SignInWithGitHub />
            <SignInMethodDivider />

            <Tabs defaultValue="password">
              <TabsList>
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
              </TabsList>
              <TabsContent value="password">
                <SignInWithPassword setStep={setStep} />
              </TabsContent>
              <TabsContent value="magic-link">
                <SignInWithMagicLink
                  handleLinkSent={() => setStep("linkSent")}
                />
              </TabsContent>
            </Tabs>
          </>
        ) : step === "linkSent" ? (
          <>
            <h2 className="font-semibold text-2xl tracking-tight">
              Check your email
            </h2>
            <p>A sign-in link has been sent to your email address.</p>
            <Button
              className="p-0 self-start"
              variant="link"
              onClick={() => setStep("signIn")}
            >
              Cancel
            </Button>
          </>
        ) : (
          <EmailVerification email={step.email} />
        )}
      </div>
    </div>
  );
}

export function SignInWithGitHub() {
  const { signIn } = useAuthActions();
  return (
    <Button
      className="flex-1"
      variant="outline"
      type="button"
      onClick={() => void signIn("github")}
    >
      <GitHubLogoIcon className="mr-2 h-4 w-4"/> GitHub
    </Button>
  );
}

function SignInWithMagicLink({
  handleLinkSent,
}: {
  handleLinkSent: () => void;
}) {
  const { signIn } = useAuthActions();
  const { toast } = useToast();
  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);

        signIn("resend", formData)
          .then(handleLinkSent)
          .catch((error) => {
            toast({
              title: `Could not send sign-in link ${error.message}`,
              variant: "destructive",
            });
          });
      }}
    >
      <label htmlFor="email">Email</label>
      <Input name="email" id="email" className="mb-4" autoComplete="email" />
      <Button type="submit">Send sign-in link</Button>
      <Toaster />
    </form>
  );
}

export function SignInWithPassword({ setStep }: { setStep: React.Dispatch<React.SetStateAction<"signIn" | "linkSent" | { email: string }>> }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signUp" | "signIn" | "forgot">("signIn");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await signIn("password", formData);
      // If the user needs to verify their email, set the step
      setStep({ email: formData.get("email") as string });
    } catch (error) {
      // Handle error (e.g., show a toast notification)
    }
  };

  return (
    <>
      {flow !== "forgot" ? (
        <form onSubmit={handleSubmit}>
          <input name="flow" type="hidden" value={flow} />
          <label htmlFor="email">Email</label>
          <Input name="email" type="text" autoComplete="email" className="mb-4" />
          <div className="flex items-center justify-between">
            <label htmlFor="password">Password</label>
            {flow === "signIn" && (
              <Button type="button" variant="link" className="p-0 h-auto" onClick={() => setFlow("forgot")}>
                Forgot your password?
              </Button>
            )}
          </div>
          <Input name="password" type="password" className="mb-4" />
          <div className="flex flex-row flex-1 gap-2">
            <Button type="submit">{flow === "signIn" ? "Sign in" : "Sign up"}</Button>
            <Button type="button" onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}>
              {flow === "signIn" ? "Sign up instead" : "Sign in instead"}
            </Button>
          </div>
        </form>
      ) : (
        <PasswordReset handleCancel={() => setFlow("signIn")} />
      )}
    </>
  );
}
