import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { loadGuestSession, saveGuestSession } from "./guestSession";

const NAME_MIN = 1;
const NAME_MAX = 40;

/**
 * Public landing page for `/share/:shareId`. Resolves the share, handles
 * invalid states (expired / revoked / not_found), and prompts the guest for
 * a display name. On submit, stores name + generated `guestSub` in
 * sessionStorage and redirects to `/share/:shareId/view`.
 */
export function ShareEntryPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const info = useQuery(
    api.shares.getShareInfo,
    shareId ? { shareId } : "skip",
  );

  const [guestName, setGuestName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // If the visitor has already entered a name in this tab, jump straight to view.
  useEffect(() => {
    if (!shareId) return;
    if (info?.status !== "active") return;
    const existing = loadGuestSession(shareId);
    if (existing) {
      void navigate(`/share/${shareId}/view`, { replace: true });
    }
  }, [shareId, info?.status, navigate]);

  if (!shareId) {
    return <ShareMessage heading="Invalid link" body="This share link is malformed." />;
  }

  if (info === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RippleSpinner size={48} />
      </div>
    );
  }

  if (info.status === "not_found") {
    return <ShareMessage heading="Link not found" body="This share link does not exist." />;
  }
  if (info.status === "revoked") {
    return <ShareMessage heading="Access revoked" body="The workspace admin has revoked this link." />;
  }
  if (info.status === "expired") {
    return <ShareMessage heading="Link expired" body="This share link has expired." />;
  }

  const trimmed = guestName.trim();
  const isValid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValid || submitted) return;
    setSubmitted(true);
    saveGuestSession(shareId, { guestSub: generateGuestSub(), guestName: trimmed });
    void navigate(`/share/${shareId}/view`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 shadow-sm"
      >
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {info.workspaceName}
          </p>
          <h1 className="text-xl font-semibold">{info.resourceName || "Shared resource"}</h1>
          <p className="text-sm text-muted-foreground">
            {describeAccess(info.resourceType, info.accessLevel)}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="guestName">Your name</Label>
          <Input
            id="guestName"
            placeholder="e.g. Alex"
            autoFocus
            value={guestName}
            maxLength={NAME_MAX}
            onChange={(e) => setGuestName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            This is shown to the other participants.
          </p>
        </div>
        <Button type="submit" className="w-full" disabled={!isValid || submitted}>
          Continue as guest
        </Button>
      </form>
    </div>
  );
}

function ShareMessage({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">{heading}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function describeAccess(
  resourceType: string | undefined,
  accessLevel: string | undefined,
): string {
  if (resourceType === "channel") return "You will join the channel call as a guest.";
  if (accessLevel === "edit") return "You can view and edit this resource.";
  return "You can view this resource.";
}

function generateGuestSub(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

