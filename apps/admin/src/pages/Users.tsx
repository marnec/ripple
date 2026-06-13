import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BotIcon,
  ChevronRightIcon,
  CrownIcon,
  SearchIcon,
  ShieldIcon,
} from "../components/icons";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  SectionLabel,
  Spinner,
  TypeToConfirmDialog,
} from "../components/ui";
import { navigate } from "../hooks/useHashRoute";
import { errorMessage } from "../lib/errors";
import { fmtDate, fmtNum, shortId } from "../lib/format";

function ProviderBadges({ providers }: { providers: string[] }) {
  const labelMap: Record<string, string> = {
    github: "GH",
    gitlab: "GL",
    password: "PWD",
    resend: "OTP",
  };
  if (providers.length === 0) return <span className="text-stone-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {providers.map((p) => (
        <Badge key={p} variant="outline">
          {labelMap[p] ?? p}
        </Badge>
      ))}
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────
export function UsersPage() {
  const users = useQuery(api.admin.users.list);
  const [q, setQ] = useState("");

  const filtered = users?.filter((u) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      u.name?.toLowerCase().includes(needle) ||
      u.email?.toLowerCase().includes(needle) ||
      u._id.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-6">
      <header className="animate-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-100">Users</h1>
          <p className="mt-1 text-sm text-stone-500">
            {users ? `${fmtNum(users.length)} accounts` : " "}
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Input
            icon={<SearchIcon className="size-4" />}
            placeholder="Search name, email, id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </header>

      <Card className="animate-rise overflow-hidden" style={{ animationDelay: "60ms" }}>
        {filtered === undefined ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState>No users match “{q}”.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-800 font-mono text-[11px] uppercase tracking-wider text-stone-500">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Providers</th>
                <th className="px-4 py-2.5 text-right font-medium">Workspaces</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/70">
              {filtered.map((u) => (
                <tr
                  key={u._id}
                  onClick={() => navigate(`/users/${u._id}`)}
                  className="cursor-pointer transition-colors hover:bg-stone-800/40"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} email={u.email} image={u.image} />
                      <div className="min-w-0">
                        <div className="truncate text-stone-200">{u.name ?? "Unnamed"}</div>
                        <div className="truncate font-mono text-xs text-stone-500">
                          {u.email ?? shortId(u._id)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <ProviderBadges providers={u.providers} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-300">
                    {u.workspaceCount}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.disabled && <Badge variant="danger">disabled</Badge>}
                      {u.isPlatformAdmin && (
                        <Badge variant="accent">
                          <ShieldIcon className="size-3" /> admin
                        </Badge>
                      )}
                      {u.isBot && (
                        <Badge variant="muted">
                          <BotIcon className="size-3" /> bot
                        </Badge>
                      )}
                      {!u.emailVerified && !u.isBot && (
                        <Badge variant="outline">unverified</Badge>
                      )}
                      {!u.isPlatformAdmin && !u.isBot && !u.disabled && u.emailVerified && (
                        <span className="text-stone-600">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-500">
                    {fmtDate(u.createdAt)}
                  </td>
                  <td className="px-2 text-stone-600">
                    <ChevronRightIcon className="size-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────
export function UserDetailPage({ userId }: { userId: Id<"users"> }) {
  const user = useQuery(api.admin.users.get, { userId });
  const viewer = useQuery(api.users.viewer);
  const setAdmin = useMutation(api.admin.users.setPlatformAdmin);
  const setDisabled = useMutation(api.admin.users.setDisabled);
  const deleteAccount = useMutation(api.admin.users.deleteAccount);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (user === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState>User not found.</EmptyState>
      </div>
    );
  }

  // Until `viewer` resolves (undefined = loading, null = not yet available) we
  // don't know who "self" is — treat it as possibly-self so the self-targeting
  // destructive buttons stay disabled rather than briefly enabling an action
  // the server would reject.
  const isSelf = viewer == null || viewer._id === user._id;

  const onError = (err: unknown) => toast.error(errorMessage(err));

  const applyAdmin = (value: boolean) => {
    setBusy(true);
    void setAdmin({ userId: user._id, value })
      .then(() => {
        toast.success(value ? "Granted platform admin." : "Revoked platform admin.");
        setConfirming(false);
      })
      .catch(onError)
      .finally(() => setBusy(false));
  };

  const toggleDisabled = (value: boolean) => {
    setBusy(true);
    void setDisabled({ userId: user._id, value })
      .then(() => toast.success(value ? "Account deactivated." : "Account reactivated."))
      .catch(onError)
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    setBusy(true);
    void deleteAccount({ userId: user._id })
      .then(() => {
        toast.success("Account deleted.");
        navigate("/users");
      })
      .catch(onError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-8">
      <BackLink />

      <header className="animate-rise flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={user.name} email={user.email} image={user.image} className="size-14 text-base" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-stone-100">{user.name ?? "Unnamed"}</h1>
              {user.isPlatformAdmin && (
                <Badge variant="accent">
                  <ShieldIcon className="size-3" /> admin
                </Badge>
              )}
              {user.disabled && <Badge variant="danger">disabled</Badge>}
              {user.isBot && <Badge variant="muted">bot</Badge>}
            </div>
            <div className="mt-1 font-mono text-sm text-stone-400">{user.email ?? "—"}</div>
            <div className="mt-0.5 font-mono text-[11px] text-stone-600">{user._id}</div>
          </div>
        </div>

        {!user.isBot && (
          <div className="flex flex-wrap items-center gap-2">
            {user.isPlatformAdmin ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isSelf || busy}
                title={isSelf ? "You can't revoke your own admin access" : undefined}
                onClick={() => setConfirming(true)}
              >
                Revoke admin
              </Button>
            ) : (
              <Button variant="accent" size="sm" disabled={busy} onClick={() => applyAdmin(true)}>
                <ShieldIcon className="size-4" /> Grant admin
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={busy || (isSelf && !user.disabled)}
              title={isSelf && !user.disabled ? "You can't disable your own account" : undefined}
              onClick={() => toggleDisabled(!user.disabled)}
            >
              {user.disabled ? "Reactivate" : "Deactivate"}
            </Button>

            <Button
              variant="danger"
              size="sm"
              disabled={busy || isSelf}
              title={isSelf ? "You can't delete your own account" : undefined}
              onClick={() => setDeleting(true)}
            >
              Delete
            </Button>
          </div>
        )}
      </header>

      <section className="animate-rise space-y-3" style={{ animationDelay: "60ms" }}>
        <SectionLabel>Identity</SectionLabel>
        <Card className="divide-y divide-stone-800">
          <DetailRow label="Providers">
            {user.providers.length ? (
              <div className="flex gap-1">
                {user.providers.map((p) => (
                  <Badge key={p} variant="outline">
                    {p}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label="Email verified">{user.emailVerified ? "Yes" : "No"}</DetailRow>
          {user.githubLogin && <DetailRow label="GitHub">@{user.githubLogin}</DetailRow>}
          {user.gitlabLogin && <DetailRow label="GitLab">@{user.gitlabLogin}</DetailRow>}
          <DetailRow label="Joined">{fmtDate(user.createdAt)}</DetailRow>
        </Card>
      </section>

      <section className="animate-rise space-y-3" style={{ animationDelay: "120ms" }}>
        <SectionLabel>Workspaces ({user.workspaces.length})</SectionLabel>
        <Card>
          {user.workspaces.length === 0 ? (
            <EmptyState>Not a member of any workspace.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-800">
              {user.workspaces.map((w) => (
                <li
                  key={w._id}
                  onClick={() => navigate(`/workspaces/${w._id}`)}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-stone-800/40"
                >
                  <span className="flex-1 truncate text-sm text-stone-200">{w.name}</span>
                  {w.isOwner && (
                    <Badge variant="accent">
                      <CrownIcon className="size-3" /> owner
                    </Badge>
                  )}
                  <Badge variant="muted">{w.role}</Badge>
                  <ChevronRightIcon className="size-4 text-stone-600" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <ConfirmDialog
        open={confirming}
        danger
        loading={busy}
        title="Revoke platform admin?"
        description={`${user.name ?? user.email ?? "This user"} will lose access to the admin app.`}
        confirmLabel="Revoke"
        onConfirm={() => applyAdmin(false)}
        onCancel={() => setConfirming(false)}
      />

      <TypeToConfirmDialog
        open={deleting}
        loading={busy}
        title="Delete this account?"
        description="Removes the user from all workspaces and deletes their login. Authored content is kept but will show as an unknown author. This can't be undone."
        phrase={user.email ?? user.name ?? "delete"}
        confirmLabel="Delete account"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}

function BackLink() {
  return (
    <button
      onClick={() => navigate("/users")}
      className="inline-flex items-center gap-1.5 text-sm text-stone-400 transition-colors hover:text-stone-200"
    >
      <ArrowLeftIcon className="size-4" /> Users
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="font-mono text-xs uppercase tracking-wider text-stone-500">{label}</span>
      <span className="text-sm text-stone-200">{children}</span>
    </div>
  );
}
