import {
  ConfirmDialog,
  EmptyState,
  LoadingPane,
  PageHeader,
  SearchInput,
  SectionLabel,
  TypeToConfirmDialog,
  UserAvatar,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { navigate } from "@/hooks/useHashRoute";
import { errorMessage } from "@/lib/errors";
import { fmtDate, fmtNum, shortId } from "@/lib/format";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeftIcon,
  BotIcon,
  ChevronRightIcon,
  CrownIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function ProviderBadges({ providers }: { providers: string[] }) {
  const labelMap: Record<string, string> = {
    github: "GH",
    gitlab: "GL",
    password: "PWD",
    resend: "OTP",
  };
  if (providers.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {providers.map((p) => (
        <Badge key={p} variant="outline" className="font-mono text-[10.5px] uppercase">
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
      <PageHeader title="Users" subtitle={users ? `${fmtNum(users.length)} accounts` : ""}>
        <SearchInput value={q} onValueChange={setQ} placeholder="Search name, email, id…" />
      </PageHeader>

      <Card className="animate-rise gap-0 py-0" style={{ animationDelay: "60ms" }}>
        {filtered === undefined ? (
          <LoadingPane className="min-h-50" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches">No users match “{q}”.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Providers</TableHead>
                <TableHead className="text-right">Workspaces</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow
                  key={u._id}
                  onClick={() => navigate(`/users/${u._id}`)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.name} email={u.email} image={u.image} />
                      <div className="min-w-0">
                        <div className="truncate">{u.name ?? "Unnamed"}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {u.email ?? shortId(u._id)}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ProviderBadges providers={u.providers} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {u.workspaceCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.disabled && <Badge variant="destructive">disabled</Badge>}
                      {u.isPlatformAdmin && (
                        <Badge className="bg-primary/15 text-primary">
                          <ShieldCheckIcon /> admin
                        </Badge>
                      )}
                      {u.isBot && (
                        <Badge variant="secondary">
                          <BotIcon /> bot
                        </Badge>
                      )}
                      {!u.emailVerified && !u.isBot && <Badge variant="outline">unverified</Badge>}
                      {!u.isPlatformAdmin && !u.isBot && !u.disabled && u.emailVerified && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fmtDate(u.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <ChevronRightIcon className="size-4" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

  if (user === undefined) return <LoadingPane />;

  if (user === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState title="User not found" />
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
          <UserAvatar
            name={user.name}
            email={user.email}
            image={user.image}
            size="lg"
            className="size-14"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{user.name ?? "Unnamed"}</h1>
              {user.isPlatformAdmin && (
                <Badge className="bg-primary/15 text-primary">
                  <ShieldCheckIcon /> admin
                </Badge>
              )}
              {user.disabled && <Badge variant="destructive">disabled</Badge>}
              {user.isBot && <Badge variant="secondary">bot</Badge>}
            </div>
            <div className="mt-1 font-mono text-sm text-muted-foreground">{user.email ?? "—"}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">{user._id}</div>
          </div>
        </div>

        {!user.isBot && (
          <div className="flex flex-wrap items-center gap-2">
            {user.isPlatformAdmin ? (
              <Button
                variant="outline"
                disabled={isSelf || busy}
                title={isSelf ? "You can't revoke your own admin access" : undefined}
                onClick={() => setConfirming(true)}
              >
                Revoke admin
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => applyAdmin(true)}>
                <ShieldCheckIcon /> Grant admin
              </Button>
            )}

            <Button
              variant="outline"
              disabled={busy || (isSelf && !user.disabled)}
              title={isSelf && !user.disabled ? "You can't disable your own account" : undefined}
              onClick={() => toggleDisabled(!user.disabled)}
            >
              {user.disabled ? "Reactivate" : "Deactivate"}
            </Button>

            <Button
              variant="destructive"
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
        <Card className="gap-0 divide-y divide-border py-0">
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
        <Card className="gap-0 py-0">
          {user.workspaces.length === 0 ? (
            <EmptyState title="No workspaces">Not a member of any workspace.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {user.workspaces.map((w) => (
                <li
                  key={w._id}
                  onClick={() => navigate(`/workspaces/${w._id}`)}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
                >
                  <span className="flex-1 truncate text-sm">{w.name}</span>
                  {w.isOwner && (
                    <Badge className="bg-primary/15 text-primary">
                      <CrownIcon /> owner
                    </Badge>
                  )}
                  <Badge variant="secondary">{w.role}</Badge>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
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
    <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/users")}>
      <ArrowLeftIcon /> Users
    </Button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
