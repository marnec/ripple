import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GitBranch, Pause, Play, RefreshCw, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLastWebhook, isFrozenOver24h } from "@/lib/integration-utils";
import { IntegrationWarning } from "@/components/IntegrationWarning";
import { useViewer } from "../UserContext";

const GITHUB_FEATURE_KEY = "github_integration";
const GITLAB_FEATURE_KEY = "gitlab_integration";

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
function CapabilityToggle({
  workspaceId,
  featureKey,
  label,
}: Props & { featureKey: string; label: string }) {
  const viewer = useViewer();
  const members = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey },
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
    setFeature({ workspaceId, featureKey, enabled: next })
      .then(() => {
        toast.success(
          next ? `${label} integration enabled` : `${label} integration disabled`,
        );
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
        <div className="text-sm font-medium">{label} integration capability</div>
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? `When disabled, all ${label} sync freezes (inbound and outbound) across this workspace.`
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
          aria-label={`Toggle ${label} integration capability`}
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
  // The link awaiting Force-resync confirmation (null = dialog closed). Held at
  // section level so a single dialog serves every row.
  const [resyncTarget, setResyncTarget] = useState<{
    linkId: Id<"projectIntegrationLinks">;
    repoFullName: string;
  } | null>(null);
  // The link awaiting Disconnect confirmation (null = dialog closed). Mirrors
  // the resync target so a single dialog serves every row.
  const [disconnectTarget, setDisconnectTarget] = useState<{
    linkId: Id<"projectIntegrationLinks">;
    repoFullName: string;
  } | null>(null);

  const confirmDisconnect = async () => {
    if (!disconnectTarget) return;
    const { linkId } = disconnectTarget;
    setDisconnectTarget(null);
    setPendingId(linkId);
    try {
      await unlinkLink({ linkId });
      toast.success("Disconnected");
    } catch (err) {
      toast.error("Operation failed", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setPendingId(null);
    }
  };

  const confirmResync = async () => {
    if (!resyncTarget) return;
    const { linkId } = resyncTarget;
    setResyncTarget(null);
    setPendingId(linkId);
    try {
      await forceResync({ linkId });
      toast.success("Resync started");
    } catch (err) {
      toast.error("Operation failed", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setPendingId(null);
    }
  };
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
      <CapabilityToggle
        workspaceId={workspaceId}
        featureKey={GITHUB_FEATURE_KEY}
        label="GitHub"
      />
      <CapabilityToggle
        workspaceId={workspaceId}
        featureKey={GITLAB_FEATURE_KEY}
        label="GitLab"
      />
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
                className={cn(
                  "flex flex-col gap-2 rounded-md border px-3 py-2",
                  isDisconnected && "opacity-60",
                )}
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
                            setResyncTarget({
                              linkId: link._id,
                              repoFullName: link.externalRepoFullName,
                            })
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
                          onClick={() =>
                            setDisconnectTarget({
                              linkId: link._id,
                              repoFullName: link.externalRepoFullName,
                            })
                          }
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
                  <IntegrationWarning variant="subtle">
                    Frozen for more than 24 hours. Restore the workspace
                    entitlement, then run Force resync to catch up on changes
                    GitHub stopped retrying.
                  </IntegrationWarning>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ResponsiveDialog
        open={resyncTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResyncTarget(null);
        }}
      >
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              Force resync from GitHub?
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {resyncTarget && (
                <>
                  Re-fetches the current GitHub state for every linked issue in{" "}
                  <span className="font-mono">{resyncTarget.repoFullName}</span>{" "}
                  and applies it.
                </>
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <IntegrationWarning>
              <strong>GitHub is treated as the source of truth.</strong> Any
              local divergence on linked tasks — status, labels, assignees — is
              overwritten to match GitHub. This is a best-effort recovery action
              and may take a while for large repositories.
            </IntegrationWarning>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setResyncTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmResync()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Force resync
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
      >
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              Disconnect repository?
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {disconnectTarget && (
                <>
                  Disconnect{" "}
                  <span className="font-mono">
                    {disconnectTarget.repoFullName}
                  </span>
                  ? Tasks survive but per-task GitHub links are removed. You can
                  reconnect later to rehydrate.
                </>
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setDisconnectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDisconnect()}
            >
              <Unplug className="mr-1.5 h-3.5 w-3.5" />
              Disconnect
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
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
