import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GitBranch, Pause, Play, RefreshCw, Unplug } from "lucide-react";
import { formatLastWebhook, isFrozenOver24h } from "@/lib/integration-utils";
import { BranchStatusMapEditor } from "./BranchStatusMapEditor";
import { useViewer } from "../UserContext";

const GITHUB_FEATURE_KEY = "github_integration";

type Props = { workspaceId: Id<"workspaces"> };

/**
 * Read-only list of the workspace's GitHub installations (the accounts the
 * App is installed on), with installer attribution. Lets admins audit who
 * connected what. Hidden entirely when there are no installations.
 */
function InstallationsList({ workspaceId }: Props) {
  const installations = useQuery(
    api.integrations.core.install.listInstallations,
    { workspaceId },
  );
  if (!installations || installations.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border px-3 py-3">
      <div className="text-sm font-medium mb-2">Installations</div>
      <ul className="space-y-1">
        {installations.map((inst) => (
          <li
            key={inst._id}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate text-foreground">
              {inst.accountLogin ?? inst.externalAccountId}
            </span>
            {inst.externalAccountType && (
              <span className="text-xs">({inst.externalAccountType})</span>
            )}
            {inst.installedByName && (
              <span className="ml-auto text-xs">
                installed by {inst.installedByName}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Workspace-admin toggle for the GitHub-integration capability. v1 is a
 * manual switch; a future billing flow flips the same `workspaceEntitlements`
 * row with a non-"manual" source, leaving this surface unchanged (PRD story
 * 62). Disabling fans `pausedByBilling=true` to every link — the freeze
 * indicators on the rows below reflect it immediately.
 *
 * Non-admins see read-only copy pointing them at an admin.
 */
function GithubCapabilityToggle({ workspaceId }: Props) {
  const viewer = useViewer();
  const members = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITHUB_FEATURE_KEY },
  );
  const setFeature = useMutation(
    api.integrations.core.entitlements.setWorkspaceFeature,
  );
  const [pending, setPending] = useState(false);

  if (!members || viewer === undefined || feature === undefined) return null;

  const isAdmin =
    members.find((m) => m.userId === viewer?._id)?.role === "admin";
  const enabled = feature.enabled;

  const handleToggle = (next: boolean) => {
    setPending(true);
    setFeature({ workspaceId, featureKey: GITHUB_FEATURE_KEY, enabled: next })
      .then(() => {
        toast.success(next ? "GitHub integration enabled" : "GitHub integration disabled");
      })
      .catch((err: unknown) => {
        toast.error("Could not update capability", {
          description: err instanceof Error ? err.message : "Please try again",
        });
      })
      .finally(() => setPending(false));
  };

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-md border px-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">GitHub integration capability</div>
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? "When disabled, all GitHub sync freezes (inbound and outbound) across this workspace."
            : enabled
              ? "Enabled for this workspace."
              : "Disabled. Ask a workspace admin to enable it."}
        </p>
      </div>
      {isAdmin ? (
        <Switch
          checked={enabled}
          disabled={pending}
          onCheckedChange={handleToggle}
          aria-label="Toggle GitHub integration capability"
        />
      ) : (
        <Badge variant="outline">{enabled ? "Enabled" : "Disabled"}</Badge>
      )}
    </div>
  );
}

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

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1">Integrations</h2>
      <p className="text-sm text-muted-foreground mb-4">
        GitHub repositories linked to projects in this workspace.
      </p>
      <GithubCapabilityToggle workspaceId={workspaceId} />
      <InstallationsList workspaceId={workspaceId} />
      {!links ? null : links.length === 0 ? (
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
                        {!isDisconnected && (
                          <>
                            {" · "}
                            <span>
                              Last webhook: {formatLastWebhook(link.lastWebhookAt, now)}
                            </span>
                          </>
                        )}
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
                  <div className="rounded-sm bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
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

// Single source of truth for link-status badge appearance. Each entry pairs a
// light and dark variant so badges stay legible in both themes (sibling
// surfaces — ConnectGithubWizard, StatusEffectMatrix — follow the same palette).
const STATUS_BADGE: Record<string, { label: string; className?: string }> = {
  revoked: {
    label: "Entitlement revoked",
    className:
      "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  active: {
    label: "Active",
    className:
      "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  paused: {
    label: "Paused",
    className:
      "bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  disconnected: {
    label: "Disconnected",
    className:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  configuring: { label: "Configuring" },
};

function StatusBadge({
  status,
  pausedByBilling,
}: {
  status: "configuring" | "active" | "paused" | "disconnected";
  pausedByBilling: boolean;
}) {
  const meta = STATUS_BADGE[pausedByBilling ? "revoked" : status];
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}
