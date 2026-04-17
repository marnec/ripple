import { useViewer } from "@/pages/App/UserContext";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { UserSettingsDialog } from "@/pages/App/UserSettingsDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { RippleSpinner } from "@/components/RippleSpinner";
import { BadgeCheck, CalendarDays, LogOut, Mail, Settings, ShieldAlert } from "lucide-react";

function getInitials(name: string, email?: string) {
  const source = name.trim() || email?.trim() || "";
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatMemberSince(creationTime: number) {
  return new Date(creationTime).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function UserProfilePage() {
  const user = useViewer();
  const updateUser = useMutation(api.users.update);
  const { signOut } = useAuthActions();

  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
        <p className="text-sm text-muted-foreground">You are not signed in.</p>
      </div>
    );
  }

  const savedName = user.name ?? "";
  const currentName = nameOverride ?? savedName;
  const trimmedName = currentName.trim();
  const hasChanges = nameOverride !== null && trimmedName !== savedName;
  const isValid = trimmedName.length > 0;
  const displayName = trimmedName || user.email || "Anonymous";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges || !isValid) return;

    setIsSaving(true);
    try {
      await updateUser({ userId: user._id, name: trimmedName });
      toast.success("Profile updated");
      setNameOverride(null);
    } catch (error) {
      toast.error("Error updating profile", {
        description: error instanceof Error ? error.message : "Please try again later.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <h1 className="hidden md:block text-2xl font-bold mb-6">Profile</h1>

      <section className="mb-8">
        <div className="relative overflow-hidden rounded-xl border bg-linear-to-br from-muted/50 via-background to-background p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-primary/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-20 -left-20 size-40 rounded-full bg-blue-500/5 blur-3xl"
          />
          <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <Avatar className="h-20 w-20 shadow-sm ring-4 ring-background">
              <AvatarImage src={user.image || undefined} alt={displayName} />
              <AvatarFallback className="text-lg font-medium">
                {getInitials(currentName, user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col items-center sm:items-start text-center sm:text-left">
              <h2 className="truncate max-w-full text-xl font-semibold tracking-tight">
                {displayName}
              </h2>
              {user.email && (
                <p className="truncate max-w-full text-sm text-muted-foreground">
                  {user.email}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                {user.emailVerificationTime ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck className="size-3" />
                    Verified
                  </span>
                ) : user.email ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="size-3" />
                    Unverified
                  </span>
                ) : null}
                {user.isAnonymous && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Guest
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Personal Information</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-name">Display Name</Label>
            <Input
              id="user-name"
              type="text"
              value={currentName}
              onChange={(e) => setNameOverride(e.target.value)}
              placeholder="Your name"
              maxLength={80}
              autoComplete="name"
              required
            />
            <p className="text-xs text-muted-foreground">
              Shown to teammates across messages, documents, and mentions.
            </p>
          </div>
          {hasChanges && (
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={!isValid || isSaving}>
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNameOverride(null)}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          )}
        </form>
      </section>

      <Separator className="my-6" />

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Account</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3">
          <dt className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="size-4" />
            Email
          </dt>
          <dd className="text-sm font-medium break-all">
            {user.email ?? (
              <span className="italic text-muted-foreground">Not set</span>
            )}
          </dd>

          <dt className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" />
            Member since
          </dt>
          <dd className="text-sm font-medium">
            {formatMemberSince(user._creationTime)}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Your email is managed by your authentication provider and cannot be
          edited here.
        </p>
      </section>

      <Separator className="my-6" />

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Settings</h2>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Manage appearance, notifications, and language preferences.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowSettings(true)}
          >
            Settings
            <Settings className="size-4" />
          </Button>
        </div>
      </section>

      <Separator className="my-6" />

      <section>
        <h2 className="text-lg font-semibold mb-4">Session</h2>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Sign out of Ripple on this device.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </section>

      <UserSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
