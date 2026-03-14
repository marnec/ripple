import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export function EmailVerification({ email }: { email: string }) {
  const { signIn } = useAuthActions();
  const [code, setCode] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append("code", code);
    formData.append("email", email);
    formData.append("flow", "email-verification");

    try {
      await signIn("password", formData);
    } catch (error) {
      toast.error(`Could not verify email ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Verify your email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a verification code to{" "}
          <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="verification-code" className="text-sm font-medium">
          Verification code
        </label>
        <Input
          name="code"
          id="verification-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter code"
          className="h-11"
          autoComplete="one-time-code"
          required
        />
      </div>
      <Button type="submit" className="h-11">
        Verify email
      </Button>
    </form>
  );
}
