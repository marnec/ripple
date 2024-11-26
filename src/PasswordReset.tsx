import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";

export function PasswordReset({ handleCancel }: { handleCancel: () => void }) {
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<"forgot" | "verification">("forgot");
  const [email, setEmail] = useState("");

  const handleForgotSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const email = formData.get("email") as string;

    // Call the signIn function to send the reset code
    await signIn("password", { email, flow: 'reset' });
    setEmail(email);
    setStep("verification");
  };

  const handleVerificationSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const code = formData.get("code") as string;
    const newPassword = formData.get("newPassword") as string;

    // Call the signIn function to reset the password
    await signIn("password", { email, code, newPassword, flow: 'reset-verification' });
    handleCancel(); // Call the cancel handler after successful reset
  };

  return step === "forgot" ? (
    <form onSubmit={handleForgotSubmit}>
      <label htmlFor="email">Recover your password</label>
      <Input name="email" placeholder="Email" type="text" className="mb-4" required />
      <div className="flex flex-row gap-2">
        <Button type="submit">Send code</Button>
        <Button type="button" onClick={handleCancel}>Cancel</Button>
      </div>
    </form>
  ) : (
    <form onSubmit={handleVerificationSubmit}>
      <Input name="code" placeholder="Code" type="text" className="mb-4" required />
      <Input name="newPassword" placeholder="New password" type="password" className="mb-4" required />
      <div className="flex flex-row gap-2">
        <Button type="submit">Continue</Button>
        <Button type="button" onClick={handleCancel}>Cancel</Button>
      </div>
    </form>
  );
}
