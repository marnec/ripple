import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "./components/AppShell";

export function App() {
  return (
    <main className="min-h-dvh">
      <AuthLoading>
        <Centered>
          <Spinner />
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
        <Spinner />
      </Centered>
    );
  }

  if (!isAdmin) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold">Not authorized</h1>
          <p className="max-w-sm text-sm text-stone-400">
            This account doesn&apos;t have admin access. Ask an existing admin to
            set <code className="text-stone-300">isPlatformAdmin</code> on your
            user in the Convex dashboard.
          </p>
          <button
            onClick={() => void signOut()}
            className="rounded-md border border-stone-700 px-3 py-1.5 text-sm hover:bg-stone-800"
          >
            Sign out
          </button>
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
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <h1 className="mb-2 text-lg font-semibold">Ripple Admin</h1>
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm outline-none focus:border-stone-500"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          autoComplete="current-password"
          className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm outline-none focus:border-stone-500"
        />
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-md bg-stone-100 px-3 py-2 text-sm font-medium text-stone-900 hover:bg-white disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>
  );
}

function Spinner() {
  return (
    <div className="size-6 animate-spin rounded-full border-2 border-stone-700 border-t-stone-300" />
  );
}
