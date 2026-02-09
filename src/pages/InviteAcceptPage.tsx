import { useToast } from "@/components/ui/use-toast";
import { SignInForm } from "@/pages/Authentication/SignInForm";
import { Authenticated, Unauthenticated, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

function AutoAcceptInvite({ inviteId }: { inviteId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
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
        toast({
          title: "Invitation accepted",
          description: "You have successfully joined the workspace",
        });
        void navigate("/");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        if (message.toLowerCase().includes("already a member")) {
          localStorage.removeItem("inviteId");
          toast({
            title: "Already a member",
            description: "You are already a member of this workspace",
          });
          void navigate("/");
        } else {
          setError(message);
        }
      }
    })();
  }, [acceptInvite, inviteId, navigate, toast]);

  if (error) {
    return (
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">Could not accept invitation</h1>
        <p className="text-destructive">{error}</p>
        <Link to="/" className="text-primary underline">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center space-y-4">
      <h1 className="text-2xl font-bold">Accepting invitation...</h1>
    </div>
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
    <div className="container flex flex-col items-center justify-center min-h-screen">
      <Authenticated>
        {inviteId && <AutoAcceptInvite inviteId={inviteId} />}
      </Authenticated>
      <Unauthenticated>
        Please sign in to accept the invitation
        <SignInForm />
      </Unauthenticated>
    </div>
  );
}
