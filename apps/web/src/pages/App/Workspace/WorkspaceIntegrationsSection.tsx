import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GitBranch, Pause, Play, RefreshCw, Unplug } from "lucide-react";
import { isFrozenOver24h } from "@/lib/integration-utils";
import { BranchStatusMapEditor } from "./BranchStatusMapEditor";

type Props = { workspaceId: Id<"workspaces"> };

/**
 * Workspace-settings "Integrations" section. Lists every GitHub link the
 * workspace has (active / paused / disconnected) and surfaces the admin
 * lifecycle controls: pause, resume, disconnect.
 *
 * Phase 8 scope: per-link controls only. The full activation wizard
 * (account picker, repo picker, import filter, preview) is not yet built;
 * Phase 1 shipped backend-only and the wizard is a future piece of work.
 * Disconnected links render as muted rows so admins can audit history.
 */
export function WorkspaceIntegrationsSection({ workspaceId }: Props) {
  const links = useQuery(api.integrations.core.links.listByWorkspace, {
    workspaceId,
  });
  const pauseLink = useMutation(api.integrations.core.links.pauseLink);
  const resumeLink = useMutation(api.integrations.core.links.resumeLink);
  const unlinkLink = useMutation(api.integrations.core.links.unlinkLink);
  const forceResync = useMutation(api.integrations.core.links.forceResync);
  const [pendingId, setPendingId] = useState<
    Id<"projectIntegrationLinks"> | null
  >(null);
  // Captured once at mount. The banner threshold is 24 h — minute-scale
  // drift between mount and re-render is irrelevant; reading `Date.now()`
  // during render trips React Compiler's purity check.
  const [now] = useState(() => Date.now());

  if (!links) return null; // initial load — no skeleton (project convention)

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1">Integrations</h2>
      <p className="text-sm text-muted-foreground mb-4">
        GitHub repositories linked to projects in this workspace.
      </p>
      {links.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No GitHub repositories linked yet. Connect one from a project's
          settings page.
        </div>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => {
            const isPending = pendingId === link._id;
            const isDisconnected = link.status === "disconnected";
            const isPaused = link.status === "paused";
            const isFrozenByBilling = link.pausedByBilling;

            const run = async (
              op: () => Promise<unknown>,
              successMsg: string,
            ) => {
              setPendingId(link._id);
              try {
                await op();
                toast.success(successMsg);
              } catch (err) {
                toast.error("Operation failed", {
                  description:
                    err instanceof Error ? err.message : "Please try again",
                });
              } finally {
                setPendingId(null);
              }
            };

            const showRestoreBanner = isFrozenOver24h(link, now);

            return (
              <li
                key={link._id}
                className={
                  "flex flex-col gap-2 rounded-md border px-3 py-2 " +
                  (isDisconnected ? "opacity-60" : "")
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="font-mono text-sm truncate">
                        {link.externalRepoFullName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {link.projectName}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={link.status}
                      pausedByBilling={isFrozenByBilling}
                    />
                    {!isDisconnected && !isFrozenByBilling && (
                      <>
                        {isPaused ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              void run(
                                () => resumeLink({ linkId: link._id }),
                                "Sync resumed",
                              )
                            }
                            className="h-8 gap-1.5"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Resume
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              void run(
                                () => pauseLink({ linkId: link._id }),
                                "Sync paused",
                              )
                            }
                            className="h-8 gap-1.5"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            Pause
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            void run(
                              () => forceResync({ linkId: link._id }),
                              "Resync started",
                            )
                          }
                          className="h-8 gap-1.5"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Force resync
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Disconnect ${link.externalRepoFullName}? Tasks survive but per-task GitHub links are removed. You can reconnect later to rehydrate.`,
                              )
                            )
                              return;
                            void run(
                              () => unlinkLink({ linkId: link._id }),
                              "Disconnected",
                            );
                          }}
                          className="h-8 gap-1.5 text-destructive hover:text-destructive"
                        >
                          <Unplug className="h-3.5 w-3.5" />
                          Disconnect
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {showRestoreBanner && (
                  <div className="rounded-sm bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Frozen for more than 24 hours. Restore the workspace
                    entitlement, then run Force resync to catch up on changes
                    GitHub stopped retrying.
                  </div>
                )}
                {!isDisconnected && (
                  <BranchStatusMapEditor
                    link={{
                      _id: link._id,
                      projectId: link.projectId,
                      branchStatusMap: link.branchStatusMap,
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({
  status,
  pausedByBilling,
}: {
  status: "configuring" | "active" | "paused" | "disconnected";
  pausedByBilling: boolean;
}) {
  if (pausedByBilling) {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-800">
        Entitlement revoked
      </Badge>
    );
  }
  switch (status) {
    case "active":
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-800">
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-800">
          Paused
        </Badge>
      );
    case "disconnected":
      return (
        <Badge variant="outline" className="bg-gray-100 text-gray-700">
          Disconnected
        </Badge>
      );
    case "configuring":
      return <Badge variant="outline">Configuring</Badge>;
  }
}
