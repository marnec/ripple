import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toast } from "sonner";

export function PasswordReset({ handleCancel }: { handleCancel: () => void }) {
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<"forgot" | "verification">("forgot");
  const [email, setEmail] = useState("");

  const handleForgotSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const email = formData.get("email") as string;

    try {
      await signIn("password", { email, flow: "reset" });
      setEmail(email);
      setStep("verification");
    } catch {
      toast.error("Could not retrieve password", {
        description: "Check your email is correct",
      });
    }
  };

  const handleVerificationSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const code = formData.get("code") as string;
    const newPassword = formData.get("newPassword") as string;

    try {
      await signIn("password", { email, code, newPassword, flow: "reset-verification" });
      handleCancel();
    } catch {
      toast.error("Something went wrong", {
        description: "Check the code is correct",
      });
    }
  };

  return step === "forgot" ? (
    <form onSubmit={(e) => void handleForgotSubmit(e)} className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Reset password</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we'll send you a reset code.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="reset-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          name="email"
          id="reset-email"
          placeholder="you@example.com"
          type="email"
          className="h-11"
          autoComplete="email"
          required
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" className="h-11 flex-1">
          Send reset code
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={handleCancel}>
          Back to sign in
        </Button>
      </div>
    </form>
  ) : (
    <form onSubmit={(e) => void handleVerificationSubmit(e)} className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Enter reset code</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a code to <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="reset-code" className="text-sm font-medium">
          Code
        </label>
        <Input
          name="code"
          id="reset-code"
          placeholder="Enter code"
          type="text"
          className="h-11"
          autoComplete="one-time-code"
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="new-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          name="newPassword"
          id="new-password"
          placeholder="Enter new password"
          type="password"
          className="h-11"
          autoComplete="new-password"
          required
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" className="h-11 flex-1">
          Reset password
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
