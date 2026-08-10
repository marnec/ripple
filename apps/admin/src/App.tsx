import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

export function App() {
  return (
    <main className="min-h-dvh">
      <AuthLoading>
        <Centered>
          <Spinner className="size-6 text-muted-foreground" />
        </Centered>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <AdminGate />
      </Authenticated>
    </main>
  );
}

/**
 * Second gate behind authentication: a signed-in user is not necessarily a
 * platform admin. `amIAdmin` is the cheap check; every data function re-verifies
 * server-side, so this is purely about which UI to show.
 */
function AdminGate() {
  const isAdmin = useQuery(api.admin.access.amIAdmin);
  const { signOut } = useAuthActions();

  if (isAdmin === undefined) {
    return (
      <Centered>
        <Spinner className="size-6 text-muted-foreground" />
      </Centered>
    );
  }

  if (!isAdmin) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold">Not authorized</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            This account doesn&apos;t have admin access. Ask an existing admin to set{" "}
            <code className="font-mono text-foreground">isPlatformAdmin</code> on your user in the
            Convex dashboard.
          </p>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Centered>
    );
  }

  return <AppShell />;
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [submitting, setSubmitting] = useState(false);

  return (
    <Centered>
      <Card className="console-grid w-full max-w-sm p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitting(true);
            const formData = new FormData(e.currentTarget);
            formData.set("flow", "signIn");
            void signIn("password", formData)
              .catch(() => {
                toast.error("Sign in failed. Check your email and password.");
              })
              .finally(() => setSubmitting(false));
          }}
          className="flex flex-col gap-3"
        >
          <div className="mb-2">
            <h1 className="text-lg font-semibold">Ripple Admin</h1>
            <p className="font-mono text-[10px] tracking-[0.22em] text-primary uppercase">
              Operator access
            </p>
          </div>
          <Input name="email" type="email" required placeholder="Email" autoComplete="email" className="h-9" />
          <Input
            name="password"
            type="password"
            required
            placeholder="Password"
            autoComplete="current-password"
            className="h-9"
          />
          <Button type="submit" size="lg" disabled={submitting} className="mt-1">
            {submitting ? <Spinner /> : null}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}
