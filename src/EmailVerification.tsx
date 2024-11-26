import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { useNavigate } from "react-router-dom";
import { toast } from "./components/ui/use-toast";

export function EmailVerification({ email }: { email: string }) {
  const { signIn } = useAuthActions();
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append("code", code);
    formData.append("email", email);
    formData.append("flow", "email-verification");

    try {
      await signIn("password", formData);
      navigate("/");
    } catch (error) {
      toast({
        title: `Could not verify email ${error}`,
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="code">Verification Code</label>
      <Input
        name="code"
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="mb-4"
        required
      />
      <Button type="submit">Verify Email</Button>
    </form>
  );
}
