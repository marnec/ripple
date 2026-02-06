import { useToast } from "@/components/ui/use-toast";
import { SignInForm } from "@/pages/Authentication/SignInForm";
import { Authenticated, Unauthenticated, useMutation } from "convex/react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function InviteAcceptPage() {
  const { inviteId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const acceptInvite = useMutation(api.workspaceInvites.accept);
  
  const removeInviteId = () => {
    if (inviteId) {
      localStorage.removeItem("inviteId");
    }
  };
  
  useEffect(() => {
    const storeInviteId = () => {
      if (inviteId) {
        localStorage.setItem("inviteId", inviteId);
      }
    };

    storeInviteId();
  }, [inviteId]);

  const handleAcceptInvite = async () => {
    try {
      await acceptInvite({ inviteId: inviteId as Id<"workspaceInvites"> });
      removeInviteId();
      toast({
        title: "Invitation accepted",
        description: "You have successfully joined the workspace",
      });
      void navigate("/");
    } catch (error) {
      toast({
        title: "Error accepting invitation",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container flex flex-col items-center justify-center min-h-screen">
      <Authenticated>
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Accept Workspace Invitation</h1>
          <p>Click below to join the workspace</p>
          <button
            onClick={() => void handleAcceptInvite()}
            className="px-4 py-2 bg-primary text-white rounded"
          >
            Accept Invite
          </button>
        </div>
      </Authenticated>
      <Unauthenticated>
        Please sign in to accept the invitation
        <SignInForm />
      </Unauthenticated>
    </div>
  );
} 