import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ripple/ui/components/dialog";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Copy, GitBranch, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  IntegrationCardShell,
  type IntegrationLink,
} from "./IntegrationCardShell";
import { WizardStepper } from "./WizardStepper";

const GITLAB_FEATURE_KEY = "gitlab_integration";

interface Props {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}

/**
 * GitLab variant of the shared integration card. Beyond the provider copy and
 * its own wizard it adds two things GitHub has no equivalent for: the
 * PAT-install webhook panel appended to each linked row, and the OAuth-callback
 * toast — kept at card level (not inside the wizard) so it fires even if the
 * user closed the wizard before the redirect.
 */
export function ConnectGitlabCard({ workspaceId, projectId }: Props) {
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

  const gitlabInstalls = (installations ?? [])
    .filter((i) => i.provider === "gitlab")
    .map((i) => ({
      externalAccountId: i.externalAccountId,
      accountLogin: i.accountLogin ?? i.externalAccountId,
    }));
  // Used to grey out picker rows that already correspond to a live link
  // somewhere in this workspace. We pass the whole workspace set so the picker
  // can label "Linked to <project>" instead of a generic "Already linked".
  const liveGitlabLinks = (workspaceLinks ?? []).filter(
    (l) => l.provider === "gitlab" && l.status !== "disconnected",
  );

  return (
    <IntegrationCardShell
      workspaceId={workspaceId}
      projectId={projectId}
      featureKey={GITLAB_FEATURE_KEY}
      copy={{
        provider: "gitlab",
        title: "GitLab",
        noun: "project",
        shortNoun: "project",
      }}
      renderLinkExtras={(link: IntegrationLink) => (
        <GitlabWebhookConfig linkId={link._id} />
      )}
      renderWizard={({ open, onOpenChange }) => (
        <ConnectGitlabWizard
          workspaceId={workspaceId}
          projectId={projectId}
          open={open}
          onOpenChange={onOpenChange}
          oauthAvailable={oauthConfigured === true}
          gitlabInstalls={gitlabInstalls}
          workspaceLinks={liveGitlabLinks}
        />
      )}
    />
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

const WIZARD_STEPS = [
  { key: "account", label: "Account" },
  { key: "project", label: "Project" },
] as const satisfies readonly { key: Step; label: string }[];

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

        <WizardStepper steps={WIZARD_STEPS} current={step} />

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
