import {
  EmptyState,
  LoadingPane,
  PageHeader,
  SectionLabel,
  StatCard,
  UserAvatar,
} from "@/components/console";
import { Card } from "@ripple/ui/components/card";
import { navigate } from "@/hooks/useHashRoute";
import { fmtNum, fmtRelative } from "@/lib/format";
import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";

/**
 * The platform-wide totals this page used to lead with are gone — every one was
 * a full-table scan on a live subscription, and the per-workspace aggregates
 * can't answer a cross-namespace question (see `admin/stats.ts`). Per-workspace
 * counts still exist on the Workspaces page, where they're served from those
 * aggregates. What's left here is the health signal and the pulse.
 */
export function OverviewPage() {
  const stats = useQuery(api.admin.stats.overview);

  if (stats === undefined) return <LoadingPane />;

  const healthy = stats.failedJobs === 0;

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" subtitle="Deployment health and recent activity." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* The one tile that is a health signal rather than a total: this is
            where an operator finds out something gave up without going looking
            for it. Zero is the expected reading, so it stays quiet until it
            isn't. Capped server-side, hence the "+". */}
        <StatCard
          label="Failed jobs"
          value={
            healthy ? (
              "0"
            ) : (
              <span className="text-destructive">
                {fmtNum(stats.failedJobs)}
                {stats.failedJobsCapped && "+"}
              </span>
            )
          }
          sub={
            healthy ? (
              "nothing gave up"
            ) : (
              <button
                onClick={() => navigate("/jobs")}
                className="text-destructive transition-opacity hover:opacity-80"
              >
                Triage →
              </button>
            )
          }
          accent={!healthy}
        />
      </div>

      <section className="animate-rise" style={{ animationDelay: "120ms" }}>
        <SectionLabel className="mb-3">Recent signups</SectionLabel>
        <Card className="gap-0 py-0">
          {stats.recentSignups.length === 0 ? (
            <EmptyState title="No signups yet" />
          ) : (
            <ul className="divide-y divide-border">
              {stats.recentSignups.map((u) => (
                <li
                  key={u._id}
                  onClick={() => navigate(`/users/${u._id}`)}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
                >
                  <UserAvatar name={u.name} email={u.email} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{u.name ?? "Unnamed"}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {u.email ?? "—"}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
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
