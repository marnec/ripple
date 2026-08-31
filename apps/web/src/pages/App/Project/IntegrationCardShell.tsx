import { Button } from "@ripple/ui/components/button";
import { Badge } from "@ripple/ui/components/badge";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { IntegrationWarning } from "@/components/IntegrationWarning";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { GitBranch, Inbox, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BranchStatusMapEditor } from "../Workspace/BranchStatusMapEditor";
import { BranchSourceDefaultsEditor } from "../Workspace/BranchSourceDefaultsEditor";

export type IntegrationLink = FunctionReturnType<
  typeof api.integrations.core.links.linksForProject
>[number];

/**
 * Per-provider copy. Everything else about the card — gating order, banners,
 * linked-row layout, disconnect confirmation — is identical between providers
 * and lives in the shell, so a new provider only supplies these four strings
 * plus its wizard.
 *
 * `noun` is the formal word for the linked thing ("repository" / "project"),
 * `shortNoun` the one the buttons use ("repo" / "project").
 */
export type IntegrationProviderCopy = {
  /** Matches `provider` on the link rows — used to partition this project's links. */
  provider: string;
  /** Display name: "GitHub" / "GitLab". */
  title: string;
  noun: string;
  shortNoun: string;
};

type Props = {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  copy: IntegrationProviderCopy;
  /** Entitlement key checked against `getWorkspaceFeature`. */
  featureKey: string;
  /** Provider-specific panel appended inside each linked row (e.g. GitLab's webhook config). */
  renderLinkExtras?: (link: IntegrationLink) => ReactNode;
  /** The connect wizard. Rendered only once the card is connectable. */
  renderWizard: (props: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) => ReactNode;
};

/**
 * Project-settings entry point for connecting an external repository. Both
 * provider cards are this shell plus a wizard: the two gates (workspace
 * entitlement, project triage status) are surfaced *before* the wizard opens
 * so users never invest effort picking a repo only to be blocked.
 *
 * Ordering, top to bottom: cross-provider conflict banner → entitlement banner
 * → linked row(s) with sub-editors → triage warning → connect button → wizard.
 *
 * A project may carry at most one provider type (`createLink` enforces it
 * server-side); the conflict banner short-circuits with a friendly message
 * rather than letting the mutation throw mid-wizard.
 */
export function IntegrationCardShell({
  workspaceId,
  projectId,
  copy,
  featureKey,
  renderLinkExtras,
  renderWizard,
}: Props) {
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey },
  );
  const gate = useQuery(api.integrations.core.activationGate.canActivate, {
    projectId,
  });
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });
  const unlink = useMutation(api.integrations.core.links.unlinkLink);
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] =
    useState<Id<"projectIntegrationLinks"> | null>(null);
  // The link awaiting Disconnect confirmation (null = dialog closed).
  const [disconnectTarget, setDisconnectTarget] = useState<{
    linkId: Id<"projectIntegrationLinks">;
    repo: string;
  } | null>(null);

  if (feature === undefined) return null;

  const ready = gate?.canActivate === true;
  const activeLinks = links ?? [];
  const ownLinks = activeLinks.filter((l) => l.provider === copy.provider);
  const conflictingLink = activeLinks.find((l) => l.provider !== copy.provider);

  const confirmDisconnect = async () => {
    if (!disconnectTarget) return;
    const { linkId, repo } = disconnectTarget;
    setDisconnectTarget(null);
    setDisconnectingId(linkId);
    try {
      await unlink({ linkId });
      toast.success(`Disconnected ${repo}`);
    } catch (err) {
      toast.error("Could not disconnect", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setDisconnectingId(null);
    }
  };

  // Status effects live on their own "Status automation" settings tab, so jump
  // there rather than scrolling within this panel.
  const goToStatusAutomation = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "status-automation");
        return next;
      },
      { replace: true },
    );
  };

  const wizard = renderWizard({ open, onOpenChange: setOpen });

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1">{copy.title}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect a {copy.title} {copy.noun} so issues sync with this project.
      </p>

      {conflictingLink ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This project is already connected to a{" "}
          <span className="font-medium capitalize">
            {conflictingLink.provider}
          </span>{" "}
          repository ({conflictingLink.externalRepoFullName}). A project can be
          linked to one provider at a time — disconnect that link first to
          connect a {copy.title} {copy.noun} here.
        </div>
      ) : !feature.enabled ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          The {copy.title} integration is disabled for this workspace. A
          workspace admin can enable it under Workspace Settings →
          Integrations.
        </div>
      ) : ownLinks.length > 0 ? (
        <div className="space-y-2">
          {ownLinks.map((link) => (
            <IntegrationLinkRow
              key={link._id}
              link={link}
              projectId={projectId}
              providerTitle={copy.title}
              disconnecting={disconnectingId === link._id}
              onDisconnect={() =>
                setDisconnectTarget({
                  linkId: link._id,
                  repo: link.externalRepoFullName,
                })
              }
            >
              {renderLinkExtras?.(link)}
            </IntegrationLinkRow>
          ))}
          <p className="text-xs text-muted-foreground">
            Resync lives under Workspace Settings → Integrations.
          </p>
          {ready && (
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(true)}
                className="gap-2"
              >
                <GitBranch className="h-4 w-4" />
                Connect another {copy.shortNoun}
              </Button>
              {wizard}
            </>
          )}
        </div>
      ) : !ready ? (
        <div className="space-y-3">
          <IntegrationWarning icon={Inbox} className="p-4">
            <p>
              Before connecting, choose where imported issues should land.{" "}
              {copy.title} issues import into an <strong>issue-inbox</strong>{" "}
              status, and this project doesn&apos;t have one yet.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 bg-transparent hover:bg-amber-100 dark:hover:bg-amber-900/40"
              onClick={goToStatusAutomation}
            >
              Set up status effects →
            </Button>
          </IntegrationWarning>
          <Button variant="outline" className="gap-2" disabled>
            <GitBranch className="h-4 w-4" />
            Connect {copy.title} {copy.shortNoun}
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="gap-2"
          >
            <GitBranch className="h-4 w-4" />
            Connect {copy.title} {copy.shortNoun}
          </Button>
          {wizard}
        </>
      )}

      <ResponsiveDialog
        open={disconnectTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDisconnectTarget(null);
        }}
      >
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              Disconnect {copy.noun}?
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {disconnectTarget && (
                <>
                  Disconnect{" "}
                  <span className="font-mono">{disconnectTarget.repo}</span>?
                  Synced issues stay, but new {copy.title} activity will no
                  longer update this project.
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
              Disconnect
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </section>
  );
}

/**
 * One connected repository: identity row + the branch/sync sub-editors every
 * provider shares. `children` is the provider-specific tail (GitLab's webhook
 * config panel).
 */
function IntegrationLinkRow({
  link,
  projectId,
  providerTitle,
  disconnecting,
  onDisconnect,
  children,
}: {
  link: IntegrationLink;
  projectId: Id<"projects">;
  providerTitle: string;
  disconnecting: boolean;
  onDisconnect: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border px-3 py-2.5">
      <div className="flex items-center gap-3 text-sm">
        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono">{link.externalRepoFullName}</span>
        <Badge
          variant={link.status === "active" ? "secondary" : "outline"}
          className="shrink-0 capitalize"
        >
          {link.pausedByBilling
            ? "Frozen"
            : link.status === "paused"
              ? "Paused"
              : "Connected"}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0 text-destructive hover:text-destructive"
          disabled={disconnecting}
          onClick={onDisconnect}
        >
          {disconnecting && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          )}
          Disconnect
        </Button>
      </div>
      <BranchStatusMapEditor
        link={{
          _id: link._id,
          projectId,
          branchStatusMap: link.branchStatusMap,
        }}
      />
      <BranchSourceDefaultsEditor
        link={{
          _id: link._id,
          defaultBaseBranch: link.defaultBaseBranch,
          askBranchSourceEachTime: link.askBranchSourceEachTime,
        }}
      />
      <InboundIssueSyncToggle
        linkId={link._id}
        providerTitle={providerTitle}
        disabled={link.inboundIssueSyncDisabled ?? false}
      />
      {children}
    </div>
  );
}

/**
 * Admin toggle for inbound issue/comment auto-sync (provider → Ripple). When
 * off, the project stops auto-pulling issue changes; PR sync and outbound push
 * keep working. The Switch reflects the link state reactively.
 */
function InboundIssueSyncToggle({
  linkId,
  providerTitle,
  disabled,
}: {
  linkId: Id<"projectIntegrationLinks">;
  providerTitle: string;
  disabled: boolean;
}) {
  const setSync = useMutation(api.integrations.core.links.setInboundIssueSync);
  const onToggle = (enabled: boolean) => {
    void setSync({ linkId, enabled }).catch((err: unknown) => {
      toast.error("Couldn't update sync setting", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    });
  };
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        Pull issue changes from {providerTitle}
      </span>
      <Switch checked={!disabled} onCheckedChange={onToggle} />
    </label>
  );
}
