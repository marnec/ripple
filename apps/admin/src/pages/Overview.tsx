import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Avatar, Card, EmptyState, SectionLabel, Spinner, StatCard } from "../components/ui";
import { fmtNum, fmtRelative } from "../lib/format";

export function OverviewPage() {
  const stats = useQuery(api.admin.stats.overview);

  if (stats === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const cards = [
    { label: "Users", value: fmtNum(stats.users), sub: `${stats.admins} admin · ${stats.bots} bot`, accent: true },
    { label: "Workspaces", value: fmtNum(stats.workspaces) },
    { label: "Channels", value: fmtNum(stats.channels) },
    { label: "Messages", value: fmtNum(stats.messages) },
    { label: "Projects", value: fmtNum(stats.projects) },
    { label: "Tasks", value: fmtNum(stats.tasks) },
    { label: "Documents", value: fmtNum(stats.documents) },
    { label: "Pending invites", value: fmtNum(stats.pendingInvites) },
  ];

  return (
    <div className="space-y-8">
      <header className="animate-rise">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-100">Overview</h1>
        <p className="mt-1 text-sm text-stone-500">Platform-wide totals across the deployment.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c, i) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            sub={c.sub}
            accent={c.accent}
            delay={i * 45}
          />
        ))}
      </div>

      <section className="animate-rise" style={{ animationDelay: "240ms" }}>
        <SectionLabel className="mb-3">Recent signups</SectionLabel>
        <Card>
          {stats.recentSignups.length === 0 ? (
            <EmptyState>No signups yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-800">
              {stats.recentSignups.map((u) => (
                <li key={u._id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={u.name} email={u.email} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-stone-200">{u.name ?? "Unnamed"}</div>
                    <div className="truncate font-mono text-xs text-stone-500">{u.email ?? "—"}</div>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-stone-500">
                    {fmtRelative(u.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
