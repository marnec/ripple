import {
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
import { fmtDate, fmtNum } from "@/lib/format";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftIcon, ChevronRightIcon, CrownIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ── List ─────────────────────────────────────────────────────────────────
export function WorkspacesPage() {
  const workspaces = useQuery(api.admin.workspaces.list);
  const [q, setQ] = useState("");

  const filtered = workspaces?.filter((w) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      w.name.toLowerCase().includes(needle) ||
      w.ownerName?.toLowerCase().includes(needle) ||
      w.ownerEmail?.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspaces"
        subtitle={workspaces ? `${fmtNum(workspaces.length)} workspaces` : ""}
      >
        <SearchInput value={q} onValueChange={setQ} placeholder="Search name or owner…" />
      </PageHeader>

      <Card className="animate-rise gap-0 py-0" style={{ animationDelay: "60ms" }}>
        {filtered === undefined ? (
          <LoadingPane className="min-h-50" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches">No workspaces match “{q}”.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Channels</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((w) => (
                <TableRow
                  key={w._id}
                  onClick={() => navigate(`/workspaces/${w._id}`)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="truncate font-medium">{w.name}</div>
                    {w.description && (
                      <div className="truncate text-xs text-muted-foreground">{w.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {w.ownerName ?? w.ownerEmail ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {w.memberCount}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {w.channelCount}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {w.projectCount}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fmtDate(w.createdAt)}
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
export function WorkspaceDetailPage({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const ws = useQuery(api.admin.workspaces.get, { workspaceId });
  const removeWorkspace = useMutation(api.admin.workspaces.remove);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirmDelete = () => {
    setBusy(true);
    void removeWorkspace({ workspaceId })
      .then(() => {
        toast.success("Workspace deletion started.");
        navigate("/workspaces");
      })
      .catch((err: unknown) => toast.error(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  if (ws === undefined) return <LoadingPane />;

  if (ws === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState title="Workspace not found" />
      </div>
    );
  }

  const counts: [string, number][] = [
    ["Channels", ws.counts.channels],
    ["Documents", ws.counts.documents],
    ["Diagrams", ws.counts.diagrams],
    ["Projects", ws.counts.projects],
    ["Tasks", ws.counts.tasks],
    ["Integrations", ws.counts.integrations],
  ];

  return (
    <div className="space-y-8">
      <BackLink />

      <header className="animate-rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{ws.name}</h1>
          {ws.description && (
            <p className="mt-1 text-sm text-muted-foreground">{ws.description}</p>
          )}
          <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">{ws._id}</div>
        </div>
        <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>
          Delete workspace
        </Button>
      </header>

      <section className="animate-rise" style={{ animationDelay: "60ms" }}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {counts.map(([label, value]) => (
            <Card key={label} className="gap-0 px-3 py-2.5">
              <div className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
                {label}
              </div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
            </Card>
          ))}
        </div>
      </section>

      <section className="animate-rise space-y-3" style={{ animationDelay: "120ms" }}>
        <SectionLabel>Members ({ws.members.length})</SectionLabel>
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {ws.members.map((m) => (
              <li
                key={m.userId}
                onClick={() => navigate(`/users/${m.userId}`)}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
              >
                <UserAvatar name={m.name} email={m.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{m.name ?? "Unnamed"}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {m.email ?? "—"}
                  </div>
                </div>
                {m.isOwner && (
                  <Badge className="bg-primary/15 text-primary">
                    <CrownIcon /> owner
                  </Badge>
                )}
                <Badge variant="secondary">{m.role}</Badge>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <TypeToConfirmDialog
        open={deleting}
        loading={busy}
        title="Delete this workspace?"
        description="Permanently deletes the workspace and everything in it — channels, messages, projects, tasks, documents, members and integrations. This can't be undone."
        phrase={ws.name}
        confirmLabel="Delete workspace"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/workspaces")}>
      <ArrowLeftIcon /> Workspaces
    </Button>
  );
}
