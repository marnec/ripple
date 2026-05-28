import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Copy, GitBranch, Inbox, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { IntegrationWarning } from "@/components/IntegrationWarning";
import { BranchStatusMapEditor } from "../Workspace/BranchStatusMapEditor";
import { BranchSourceDefaultsEditor } from "../Workspace/BranchSourceDefaultsEditor";
import { InboundIssueSyncToggle } from "./ConnectGithubWizard";

const GITLAB_FEATURE_KEY = "gitlab_integration";

interface Props {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}

/**
 * Project-settings entry point for connecting a GitLab project. Mirrors the
 * GitHub card's shape and ordering so the two integrations feel like one
 * surface: gating banner → linked-row(s) with sub-editors → triage warning →
 * "Connect" button → modal wizard. The wizard owns the account picker, the
 * project picker (with already-linked guard), and the PAT fallback.
 *
 * One-link-per-project is enforced by hiding the connect button once a GitLab
 * link exists — matches the GitHub card's behavior. Server-side, `createLink`
 * still rejects mixing providers on the same project.
 */
export function ConnectGitlabCard({ workspaceId, projectId }: Props) {
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITLAB_FEATURE_KEY },
  );
  const gate = useQuery(api.integrations.core.activationGate.canActivate, {
    projectId,
  });
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });
  const oauthConfigured = useQuery(
    api.integrations.gitlab.registerProjectAction.isOAuthConfigured,
    {},
  );
  const installations = useQuery(
    api.integrations.core.install.listInstallations,
    { workspaceId },
  );
  const workspaceLinks = useQuery(
    api.integrations.core.links.listByWorkspace,
    { workspaceId },
  );

  const unlink = useMutation(api.integrations.core.links.unlinkLink);

  const [open, setOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] =
    useState<Id<"projectIntegrationLinks"> | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{
    linkId: Id<"projectIntegrationLinks">;
    repo: string;
  } | null>(null);

  // OAuth-callback toast surfaces once on return from GitLab. Kept at card
  // level (not inside the wizard) so the toast fires even if the user closed
  // the wizard before the redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gitlab_oauth");
    if (status === "success") {
      toast.success("Connected to GitLab");
    } else if (status === "error") {
      toast.error("GitLab connection failed", {
        description: "Please try again.",
      });
    }
    if (status) {
      params.delete("gitlab_oauth");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState(null, "", next);
    }
  }, []);

  if (feature === undefined) return null;

  const ready = gate?.canActivate === true;
  const activeLinks = links ?? [];
  const gitlabLinks = activeLinks.filter((l) => l.provider === "gitlab");
  const conflictingLink = activeLinks.find((l) => l.provider !== "gitlab");
  const gitlabInstalls = (installations ?? []).filter(
    (i) => i.provider === "gitlab",
  );

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

  const scrollToEffects = () => {
    document
      .getElementById("status-effects")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1">GitLab</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect a GitLab project so issues sync with this project.
      </p>

      {conflictingLink ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This project is already connected to a{" "}
          <span className="font-medium capitalize">
            {conflictingLink.provider}
          </span>{" "}
          repository ({conflictingLink.externalRepoFullName}). A project can be
          linked to one provider at a time — disconnect that link first to
          connect a GitLab project here.
        </div>
      ) : !feature.enabled ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          The GitLab integration is disabled for this workspace. A workspace
          admin can enable it under Workspace Settings → Integrations.
        </div>
      ) : gitlabLinks.length > 0 ? (
        <div className="space-y-2">
          {gitlabLinks.map((link) => (
            <GitlabLinkedRow
              key={link._id}
              link={link}
              projectId={projectId}
              disconnecting={disconnectingId === link._id}
              onDisconnect={() =>
                setDisconnectTarget({
                  linkId: link._id,
                  repo: link.externalRepoFullName,
                })
              }
            />
          ))}
          <p className="text-xs text-muted-foreground">
            Resync lives under Workspace Settings → Integrations.
          </p>
        </div>
      ) : !ready ? (
        <div className="space-y-3">
          <IntegrationWarning icon={Inbox} className="p-4">
            <p>
              Before connecting, choose where imported issues should land.
              GitLab issues import into an <strong>issue-inbox</strong> status,
              and this project doesn&apos;t have one yet.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 bg-transparent hover:bg-amber-100 dark:hover:bg-amber-900/40"
              onClick={scrollToEffects}
            >
              Set up status effects →
            </Button>
          </IntegrationWarning>
          <Button variant="outline" className="gap-2" disabled>
            <GitBranch className="h-4 w-4" />
            Connect GitLab project
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
            Connect GitLab project
          </Button>
          <ConnectGitlabWizard
            workspaceId={workspaceId}
            projectId={projectId}
            open={open}
            onOpenChange={setOpen}
            oauthAvailable={oauthConfigured === true}
            gitlabInstalls={gitlabInstalls.map((i) => ({
              externalAccountId: i.externalAccountId,
              accountLogin: i.accountLogin ?? i.externalAccountId,
            }))}
            // Used to grey out picker rows that already correspond to a live
            // link somewhere in this workspace. We pass the whole workspace
            // set so the picker can label "Linked to <project>" instead of
            // a generic "Already linked".
            workspaceLinks={(workspaceLinks ?? []).filter(
              (l) => l.provider === "gitlab" && l.status !== "disconnected",
            )}
          />
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
              Disconnect project?
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {disconnectTarget && (
                <>
                  Disconnect{" "}
                  <span className="font-mono">{disconnectTarget.repo}</span>?
                  Synced issues stay, but new GitLab activity will no longer
                  update this project.
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

// ───────────────────────────────────────────────────────────────────────────
// Linked-row: matches the GitHub linked row's layout 1:1, plus a conditional
// PAT-only webhook configuration panel below the sub-editors.
// ───────────────────────────────────────────────────────────────────────────

type LinkRow = {
  _id: Id<"projectIntegrationLinks">;
  externalRepoFullName: string;
  status: "configuring" | "active" | "paused" | "disconnected";
  pausedByBilling: boolean;
  branchStatusMap?: { branch: string; statusId: Id<"taskStatuses"> }[];
  defaultBaseBranch?: string;
  askBranchSourceEachTime?: boolean;
  inboundIssueSyncDisabled?: boolean;
};

function GitlabLinkedRow({
  link,
  projectId,
  disconnecting,
  onDisconnect,
}: {
  link: LinkRow;
  projectId: Id<"projects">;
  disconnecting: boolean;
  onDisconnect: () => void;
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
        disabled={link.inboundIssueSyncDisabled ?? false}
      />
      <GitlabWebhookConfig linkId={link._id} />
    </div>
  );
}

/**
 * Webhook URL + secret panel — only meaningful for PAT installs (the admin has
 * to paste these into GitLab → Settings → Webhooks themselves). OAuth installs
 * auto-register the hook during the link wizard, so the panel is hidden to
 * avoid implying manual setup is needed.
 */
function GitlabWebhookConfig({
  linkId,
}: {
  linkId: Id<"projectIntegrationLinks">;
}) {
  const config = useQuery(api.integrations.core.links.getLinkWebhookConfig, {
    linkId,
  });
  if (config === undefined) return null;
  if (config.provider !== "gitlab") return null;
  if (config.installType === "oauth") return null;

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Could not copy ${label}`),
    );
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Webhook configuration
        </p>
        <p className="text-[11px] text-muted-foreground">
          Token install — add a webhook on your GitLab project (Settings →
          Webhooks) with the URL and secret below; trigger on Issues, Comments,
          and Merge request events.
        </p>
      </div>
      <CopyField
        label="URL"
        value={config.webhookUrl}
        onCopy={() => copy(config.webhookUrl, "Webhook URL")}
      />
      {config.webhookSecret ? (
        <CopyField
          label="Secret token"
          value={config.webhookSecret}
          mask
          onCopy={() => copy(config.webhookSecret!, "Secret token")}
        />
      ) : null}
    </div>
  );
}

function CopyField({
  label,
  value,
  mask,
  onCopy,
}: {
  label: string;
  value: string;
  mask?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">
          {mask ? "•".repeat(Math.min(value.length, 24)) : value}
        </code>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Wizard — mirrors ConnectGithubWizard's shape. Two steps because GitLab has
// no import filter (linking creates the webhook and that's it).
// ───────────────────────────────────────────────────────────────────────────

interface InstallSummary {
  externalAccountId: string;
  accountLogin: string;
}

type WorkspaceLinkSummary = {
  externalRepoId: string;
  projectName: string;
};

type Step = "account" | "project";

const STEP_ORDER: Step[] = ["account", "project"];
const STEP_LABELS: Record<Step, string> = {
  account: "Account",
  project: "Project",
};

function ConnectGitlabWizard({
  workspaceId,
  projectId,
  open,
  onOpenChange,
  oauthAvailable,
  gitlabInstalls,
  workspaceLinks,
}: Props & {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  oauthAvailable: boolean;
  gitlabInstalls: InstallSummary[];
  workspaceLinks: WorkspaceLinkSummary[];
}) {
  const [step, setStep] = useState<Step>("account");
  const [accountId, setAccountId] = useState<string | null>(
    gitlabInstalls[0]?.externalAccountId ?? null,
  );

  const reset = () => {
    setStep("account");
    setAccountId(gitlabInstalls[0]?.externalAccountId ?? null);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // When OAuth isn't configured (self-hosted, env vars missing), the wizard
  // collapses to the PAT form on the account step — there's no OAuth account
  // to pick from.
  const showPickAccount = oauthAvailable && gitlabInstalls.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect GitLab project</DialogTitle>
          <DialogDescription>
            {step === "account" &&
              (showPickAccount
                ? "Choose the GitLab account to link from."
                : "Connect a GitLab account to continue.")}
            {step === "project" &&
              "Pick the GitLab project to link to this Ripple project. Already-linked projects are disabled."}
          </DialogDescription>
        </DialogHeader>

        <Stepper current={step} />

        {step === "account" && (
          <AccountStep
            workspaceId={workspaceId}
            projectId={projectId}
            oauthAvailable={oauthAvailable}
            gitlabInstalls={gitlabInstalls}
            activeAccount={accountId}
            onPickAccount={(id) => {
              setAccountId(id);
              setStep("project");
            }}
          />
        )}

        {step === "project" && accountId && (
          <ProjectStep
            workspaceId={workspaceId}
            projectId={projectId}
            externalAccountId={accountId}
            workspaceLinks={workspaceLinks}
            onLinked={() => handleOpenChange(false)}
          />
        )}

        <DialogFooter>
          {step === "project" && (
            <Button variant="ghost" onClick={() => setStep("account")}>
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: Step }) {
  const currentIndex = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex items-center gap-1.5 text-xs">
      {STEP_ORDER.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium transition-colors",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary/40 bg-primary/10 text-primary",
                !active &&
                  !done &&
                  "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 && (
              <span className="mx-0.5 h-px w-3 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AccountStep({
  workspaceId,
  projectId,
  oauthAvailable,
  gitlabInstalls,
  activeAccount,
  onPickAccount,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  oauthAvailable: boolean;
  gitlabInstalls: InstallSummary[];
  activeAccount: string | null;
  onPickAccount: (externalAccountId: string) => void;
}) {
  const [showPat, setShowPat] = useState(!oauthAvailable);

  return (
    <div className="space-y-2">
      {gitlabInstalls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No GitLab accounts connected yet.
        </p>
      ) : (
        gitlabInstalls.map((inst) => (
          <button
            key={inst.externalAccountId}
            type="button"
            onClick={() => onPickAccount(inst.externalAccountId)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent",
              activeAccount === inst.externalAccountId &&
                "border-primary/50 bg-accent/40",
            )}
          >
            <GitBranch className="h-4 w-4 shrink-0" />
            <span className="truncate">{inst.accountLogin}</span>
          </button>
        ))
      )}

      {oauthAvailable && (
        <div className="flex items-center gap-3 pt-1">
          <BeginOAuthButton
            workspaceId={workspaceId}
            label={
              gitlabInstalls.length === 0
                ? "Connect with GitLab"
                : "+ Connect another account"
            }
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setShowPat((v) => !v)}
          >
            {showPat ? "Hide advanced" : "Use a token instead"}
          </button>
        </div>
      )}

      {showPat && (
        <PatConnectForm workspaceId={workspaceId} projectId={projectId} />
      )}
    </div>
  );
}

function BeginOAuthButton({
  workspaceId,
  label,
}: {
  workspaceId: Id<"workspaces">;
  label: string;
}) {
  const beginOAuth = useAction(api.integrations.gitlab.oauthAction.beginOAuth);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        beginOAuth({ workspaceId })
          .then(({ url }) => {
            window.location.href = url;
          })
          .catch((err: unknown) => {
            toast.error("Could not start GitLab OAuth", {
              description: err instanceof Error ? err.message : undefined,
            });
            setBusy(false);
          });
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}

function ProjectStep({
  workspaceId,
  projectId,
  externalAccountId,
  workspaceLinks,
  onLinked,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  externalAccountId: string;
  workspaceLinks: WorkspaceLinkSummary[];
  onLinked: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // `null` = "not yet fetched" → loading state. On re-fetch we keep the stale
  // list visible until the new page arrives (no flicker).
  const [projects, setProjects] = useState<Array<{
    id: number;
    pathWithNamespace: string;
    defaultBranch: string | null;
    webUrl: string;
  }> | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  const list = useAction(
    api.integrations.gitlab.registerProjectAction.listMyProjects,
  );
  const register = useAction(
    api.integrations.gitlab.registerProjectAction.registerProject,
  );

  useEffect(() => {
    let cancelled = false;
    list({
      workspaceId,
      externalAccountId,
      page,
      perPage: 20,
      ...(search.trim() ? { search } : {}),
    })
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error("Could not load GitLab projects", {
          description: err instanceof Error ? err.message : undefined,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [externalAccountId, page, search, workspaceId, list]);

  const loading = projects === null;

  // GitLab numeric id → owning Ripple project name. The schema stores
  // `externalRepoId` as a string, so we compare against `String(p.id)`.
  const linkedByRepoId = new Map(
    workspaceLinks.map((l) => [l.externalRepoId, l.projectName]),
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          placeholder="Search projects…"
          className="pl-8"
          autoFocus
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : projects.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No projects found. You need Maintainer or higher to register webhooks.
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto rounded-md border divide-y">
          {projects.map((p) => {
            const linkedTo = linkedByRepoId.get(String(p.id));
            const isLinked = !!linkedTo;
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                  isLinked && "opacity-60",
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {p.pathWithNamespace}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {isLinked
                      ? `Linked to ${linkedTo}`
                      : p.defaultBranch
                        ? `default: ${p.defaultBranch}`
                        : ""}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={linkingId !== null || isLinked}
                  onClick={() => {
                    setLinkingId(p.id);
                    register({
                      workspaceId,
                      projectId,
                      externalAccountId,
                      gitlabProjectId: p.id,
                      pathWithNamespace: p.pathWithNamespace,
                    })
                      .then(() => {
                        toast.success(`Linked ${p.pathWithNamespace}`, {
                          description: "Webhook registered on GitLab.",
                        });
                        onLinked();
                      })
                      .catch((err: unknown) => {
                        toast.error("Could not link project", {
                          description:
                            err instanceof Error ? err.message : undefined,
                        });
                      })
                      .finally(() => setLinkingId(null));
                  }}
                >
                  {linkingId === p.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isLinked ? (
                    "Linked"
                  ) : (
                    "Link"
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          className="underline disabled:no-underline disabled:opacity-50"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="underline disabled:no-underline disabled:opacity-50"
          disabled={loading || (projects?.length ?? 0) < 20}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Legacy PAT form, surfaced inside the wizard's account step under "Use a
 * token instead". For self-hosted GitLab or accounts where OAuth isn't
 * configured. After the install completes, the admin still has to paste the
 * webhook URL + secret into GitLab themselves (the linked-row's PAT panel
 * exposes both fields).
 */
function PatConnectForm({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const completeInstall = useMutation(
    api.integrations.core.install.completeAppInstallation,
  );
  const createLink = useMutation(api.integrations.core.links.createLink);

  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    if (!account || !token || !projectPath || !gitlabProjectId) {
      toast.error("Fill in account, token, project path, and project id");
      return;
    }
    setBusy(true);
    try {
      await completeInstall({
        workspaceId,
        provider: "gitlab",
        externalAccountId: account,
        accountLogin: account,
        credentialToken: token,
      });
      await createLink({
        projectId,
        workspaceId,
        externalAccountId: account,
        externalRepoId: gitlabProjectId,
        externalRepoFullName: projectPath,
      });
      toast.success(`Connected ${projectPath}`, {
        description: "Register the webhook from the linked-project panel.",
      });
      setToken("");
      setProjectPath("");
      setGitlabProjectId("");
    } catch (err) {
      toast.error("Could not connect GitLab", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-3 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        Connect with a personal access token
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="gl-account" className="text-xs">
            Account / namespace
          </Label>
          <Input
            id="gl-account"
            placeholder="my-group"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gl-token" className="text-xs">
            Access token
          </Label>
          <Input
            id="gl-token"
            type="password"
            placeholder="glpat-…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gl-path" className="text-xs">
            Project path
          </Label>
          <Input
            id="gl-path"
            placeholder="my-group/my-project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gl-id" className="text-xs">
            Project id (numeric)
          </Label>
          <Input
            id="gl-id"
            placeholder="123456"
            value={gitlabProjectId}
            onChange={(e) => setGitlabProjectId(e.target.value)}
          />
        </div>
      </div>
      <Button onClick={() => void connect()} disabled={busy} size="sm">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Connect project"
        )}
      </Button>
    </div>
  );
}
