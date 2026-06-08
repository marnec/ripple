import { useAuthActions } from "@convex-dev/auth/react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "../../components/ui/input-otp";

const CODE_LENGTH = 8;

const slotClassName =
  "h-11 w-11 text-base border-white/15 bg-white/5 text-white first:rounded-l-lg last:rounded-r-lg data-[active=true]:border-white/40 data-[active=true]:ring-white/30";

export function EmailVerification({
  email,
  onBack,
  onVerified,
}: {
  email: string;
  /** Return to the auth form (also clears the persisted verification state). */
  onBack: () => void;
  /** Called after a code verifies — clears the persisted verification state. */
  onVerified: () => void;
}) {
  const { signIn } = useAuthActions();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const verify = async (value: string) => {
    setSubmitting(true);
    const formData = new FormData();
    formData.append("code", value);
    formData.append("email", email);
    formData.append("flow", "email-verification");

    try {
      await signIn("password", formData);
      onVerified();
    } catch {
      toast.error("Could not verify code", {
        description:
          "That code is invalid or expired. Use the most recent code, or resend a new one.",
      });
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length === CODE_LENGTH && !submitting) void verify(code);
  };

  // Re-sends a fresh code via the same email-verification flow (no `code` param
  // means the server generates and emails a new one). This replaces any
  // previously-sent code server-side, so only the newest email will work.
  const handleResend = async () => {
    setResending(true);
    const formData = new FormData();
    formData.append("email", email);
    formData.append("flow", "email-verification");

    try {
      await signIn("password", formData);
      setCode("");
      toast.success("New code sent", {
        description: `We emailed a fresh code to ${email}. Earlier codes no longer work.`,
      });
    } catch {
      toast.error("Could not resend code", {
        description: "Please try again in a moment.",
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Verify your email</h2>
        <p className="mt-1 text-sm text-white/60">
          We sent a verification code to{" "}
          <span className="font-medium text-white">{email}</span>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Verification code</span>
        <InputOTP
          maxLength={CODE_LENGTH}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          onComplete={(value) => void verify(value)}
          disabled={submitting}
          autoFocus
          containerClassName="justify-center"
        >
          <InputOTPGroup className="gap-1.5">
            <InputOTPSlot index={0} className={slotClassName} />
            <InputOTPSlot index={1} className={slotClassName} />
            <InputOTPSlot index={2} className={slotClassName} />
            <InputOTPSlot index={3} className={slotClassName} />
          </InputOTPGroup>
          <InputOTPSeparator className="text-white/40" />
          <InputOTPGroup className="gap-1.5">
            <InputOTPSlot index={4} className={slotClassName} />
            <InputOTPSlot index={5} className={slotClassName} />
            <InputOTPSlot index={6} className={slotClassName} />
            <InputOTPSlot index={7} className={slotClassName} />
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        type="submit"
        disabled={submitting || code.length !== CODE_LENGTH}
        className="h-11 bg-white text-black hover:bg-white/90 font-medium"
      >
        {submitting ? "Verifying…" : "Verify email"}
      </Button>

      <div className="flex flex-col items-center gap-2 text-sm text-white/55">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={resending}
          className="underline-offset-4 hover:text-white hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {resending ? "Sending…" : "Didn't get a code? Resend"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-white/45 underline-offset-4 hover:text-white hover:underline"
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
