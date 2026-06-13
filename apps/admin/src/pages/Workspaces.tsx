import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeftIcon, ChevronRightIcon, CrownIcon, SearchIcon } from "../components/icons";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SectionLabel,
  Spinner,
  TypeToConfirmDialog,
} from "../components/ui";
import { navigate } from "../hooks/useHashRoute";
import { errorMessage } from "../lib/errors";
import { fmtDate, fmtNum } from "../lib/format";

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
      <header className="animate-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-100">Workspaces</h1>
          <p className="mt-1 text-sm text-stone-500">
            {workspaces ? `${fmtNum(workspaces.length)} workspaces` : " "}
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Input
            icon={<SearchIcon className="size-4" />}
            placeholder="Search name or owner…"
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
          <EmptyState>No workspaces match “{q}”.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-800 font-mono text-[11px] uppercase tracking-wider text-stone-500">
                <th className="px-4 py-2.5 font-medium">Workspace</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 text-right font-medium">Members</th>
                <th className="px-4 py-2.5 text-right font-medium">Channels</th>
                <th className="px-4 py-2.5 text-right font-medium">Projects</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/70">
              {filtered.map((w) => (
                <tr
                  key={w._id}
                  onClick={() => navigate(`/workspaces/${w._id}`)}
                  className="cursor-pointer transition-colors hover:bg-stone-800/40"
                >
                  <td className="px-4 py-2.5">
                    <div className="truncate font-medium text-stone-200">{w.name}</div>
                    {w.description && (
                      <div className="truncate text-xs text-stone-500">{w.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-stone-400">
                    {w.ownerName ?? w.ownerEmail ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-300">
                    {w.memberCount}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-300">
                    {w.channelCount}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-300">
                    {w.projectCount}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-500">
                    {fmtDate(w.createdAt)}
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

  if (ws === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (ws === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState>Workspace not found.</EmptyState>
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
          <h1 className="text-xl font-semibold text-stone-100">{ws.name}</h1>
          {ws.description && <p className="mt-1 text-sm text-stone-400">{ws.description}</p>}
          <div className="mt-1 font-mono text-[11px] text-stone-600">{ws._id}</div>
        </div>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => setDeleting(true)}>
          Delete workspace
        </Button>
      </header>

      <section className="animate-rise" style={{ animationDelay: "60ms" }}>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {counts.map(([label, value]) => (
            <Card key={label} className="px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-500">
                {label}
              </div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-stone-100">
                {value}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="animate-rise space-y-3" style={{ animationDelay: "120ms" }}>
        <SectionLabel>Members ({ws.members.length})</SectionLabel>
        <Card>
          <ul className="divide-y divide-stone-800">
            {ws.members.map((m) => (
              <li
                key={m.userId}
                onClick={() => navigate(`/users/${m.userId}`)}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-stone-800/40"
              >
                <Avatar name={m.name} email={m.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-stone-200">{m.name ?? "Unnamed"}</div>
                  <div className="truncate font-mono text-xs text-stone-500">{m.email ?? "—"}</div>
                </div>
                {m.isOwner && (
                  <Badge variant="accent">
                    <CrownIcon className="size-3" /> owner
                  </Badge>
                )}
                <Badge variant="muted">{m.role}</Badge>
                <ChevronRightIcon className="size-4 text-stone-600" />
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
    <button
      onClick={() => navigate("/workspaces")}
      className="inline-flex items-center gap-1.5 text-sm text-stone-400 transition-colors hover:text-stone-200"
    >
      <ArrowLeftIcon className="size-4" /> Workspaces
    </button>
  );
}
