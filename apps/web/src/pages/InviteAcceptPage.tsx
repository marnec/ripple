import { toast } from "sonner";
import { SignInForm } from "@/pages/Authentication/SignInForm";
import { AuthLayout } from "@/pages/Authentication/AuthLayout";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { RippleSpinner } from "@/components/RippleSpinner";

function AutoAcceptInvite({ inviteId }: { inviteId: string }) {
  const navigate = useNavigate();
  const acceptInvite = useMutation(api.workspaceInvites.accept);
  const hasRun = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    void (async () => {
      try {
        await acceptInvite({ inviteId: inviteId as Id<"workspaceInvites"> });
        localStorage.removeItem("inviteId");
        toast.success("Invitation accepted", {
          description: "You have successfully joined the workspace",
        });
        void navigate("/");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        if (message.toLowerCase().includes("already a member")) {
          localStorage.removeItem("inviteId");
          toast("Already a member", {
            description: "You are already a member of this workspace",
          });
          void navigate("/");
        } else {
          setError(message);
        }
      }
    })();
  }, [acceptInvite, inviteId, navigate]);

  if (error) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Could not accept invitation</h1>
        <p className="text-sm text-destructive">{error}</p>
        <Link to="/" className="inline-block text-sm font-medium text-primary underline underline-offset-4">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center space-y-4 py-8">
      <RippleSpinner size={48} />
      <h1 className="text-xl font-semibold tracking-tight">Accepting invitation...</h1>
    </div>
  );
}

function InviteSignIn({ inviteId }: { inviteId: string }) {
  const invite = useQuery(api.workspaceInvites.getPublic, { inviteId });

  // Loading — blocking section load, spinner is acceptable per UX guidelines.
  if (invite === undefined) {
    return (
      <div className="flex justify-center py-8">
        <RippleSpinner size={48} />
      </div>
    );
  }

  if (invite === null) {
    return (
      <div className="text-center space-y-4 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Invitation not found</h1>
        <p className="text-sm text-muted-foreground">
          This invitation link is invalid or has expired.
        </p>
        <Link to="/" className="inline-block text-sm font-medium text-primary underline underline-offset-4">
          Go to Home
        </Link>
      </div>
    );
  }

  if (invite.status !== InviteStatus.PENDING) {
    return (
      <div className="text-center space-y-4 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Invitation no longer active</h1>
        <p className="text-sm text-muted-foreground">
          This invitation to {invite.workspaceName} has already been{" "}
          {invite.status === InviteStatus.ACCEPTED ? "accepted" : "declined"}.
        </p>
        <Link to="/" className="inline-block text-sm font-medium text-primary underline underline-offset-4">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{invite.inviterName}</span> invited
          you to join <span className="font-medium text-foreground">{invite.workspaceName}</span>.
          Create your account to accept.
        </p>
      </div>
      <SignInForm lockedEmail={invite.email} defaultFlow="signUp" />
    </>
  );
}

export function InviteAcceptPage() {
  const { inviteId } = useParams();

  useEffect(() => {
    if (inviteId) {
      localStorage.setItem("inviteId", inviteId);
    }
  }, [inviteId]);

  return (
    <AuthLayout>
      <Authenticated>
        {inviteId && <AutoAcceptInvite inviteId={inviteId} />}
      </Authenticated>
      <Unauthenticated>
        {inviteId && <InviteSignIn inviteId={inviteId} />}
      </Unauthenticated>
    </AuthLayout>
  );
}
