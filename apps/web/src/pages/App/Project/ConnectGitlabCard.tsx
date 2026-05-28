import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Copy, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const GITLAB_FEATURE_KEY = "gitlab_integration";

interface Props {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}

/**
 * Connect a GitLab project to this Ripple project. Two paths depending on what
 * the deployment exposes:
 *  - OAuth (preferred): a Connect button kicks off the GitLab OAuth dance; the
 *    callback writes the install. Then a project picker lists projects the
 *    user has Maintainer+ on, and one click links the project AND registers
 *    the webhook on GitLab in a single action.
 *  - PAT (advanced / self-hosted fallback): the legacy paste-a-token form,
 *    requires the user to also create the webhook by hand on GitLab.
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
  // List of GitLab installs already on this workspace — drives the picker after
  // OAuth so the user can re-use an existing install instead of re-authing.
  const installations = useQuery(
    api.integrations.core.install.listInstallations,
    { workspaceId },
  );

  if (feature === undefined) return null;

  const ready = gate?.canActivate === true;
  const activeLinks = links ?? [];
  const gitlabInstalls = (installations ?? []).filter(
    (i) => i.provider === "gitlab",
  );
  // A project may carry at most one provider type (server-side rule in
  // `createLink`). Detect a conflict ahead of the picker so the user is told
  // up-front instead of getting a raw mutation error after picking a project.
  const conflictingLink = activeLinks.find((l) => l.provider !== "gitlab");

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1">GitLab</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect a GitLab project so issues sync with this project.
      </p>

      {!feature.enabled ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          The GitLab integration is disabled for this workspace. A workspace
          admin can enable it under Workspace Settings → Integrations.
        </div>
      ) : (
        <div className="space-y-4">
          {activeLinks
            .filter((l) => l.provider === "gitlab")
            .map((link) => (
              <GitlabLinkRow key={link._id} linkId={link._id} />
            ))}

          {conflictingLink ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              This project is already connected to a{" "}
              <span className="font-medium capitalize">
                {conflictingLink.provider}
              </span>{" "}
              repository ({conflictingLink.externalRepoFullName}). A project
              can be linked to one provider at a time — disconnect that link
              first to connect a GitLab project here.
            </div>
          ) : !ready ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              This project needs a triage status before it can receive GitLab
              issues. Set one in Status effects above.
            </div>
          ) : (
            <ConnectFlow
              workspaceId={workspaceId}
              projectId={projectId}
              oauthAvailable={oauthConfigured === true}
              gitlabInstalls={gitlabInstalls.map((i) => ({
                externalAccountId: i.externalAccountId,
                accountLogin: i.accountLogin ?? i.externalAccountId,
              }))}
            />
          )}
        </div>
      )}
    </section>
  );
}

interface InstallSummary {
  externalAccountId: string;
  accountLogin: string;
}

/**
 * The chooser. When OAuth isn't configured (self-hosted, or env vars missing
 * locally), falls back to the legacy PAT form directly. When OAuth IS
 * configured but no install exists yet, shows "Connect with GitLab". Once an
 * install exists, shows the project picker.
 */
function ConnectFlow({
  workspaceId,
  projectId,
  oauthAvailable,
  gitlabInstalls,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  oauthAvailable: boolean;
  gitlabInstalls: InstallSummary[];
}) {
  const [showPat, setShowPat] = useState(false);

  // If the user just came back from the OAuth callback, surface a toast once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gitlab_oauth");
    if (status === "success") {
      toast.success("Connected to GitLab");
      params.delete("gitlab_oauth");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState(null, "", next);
    } else if (status === "error") {
      toast.error("GitLab connection failed", {
        description: "Please try again.",
      });
      params.delete("gitlab_oauth");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState(null, "", next);
    }
  }, []);

  if (!oauthAvailable) {
    return (
      <PatConnectForm workspaceId={workspaceId} projectId={projectId} />
    );
  }

  if (gitlabInstalls.length === 0) {
    return (
      <div className="rounded-md border p-4 space-y-3">
        <p className="text-sm font-medium">Connect a GitLab account</p>
        <p className="text-sm text-muted-foreground">
          You'll be sent to GitLab to approve access. After approval, pick the
          project to link — the webhook is registered automatically.
        </p>
        <div className="flex items-center gap-3">
          <BeginOAuthButton workspaceId={workspaceId} />
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setShowPat((v) => !v)}
          >
            {showPat ? "Hide advanced" : "Use a token instead"}
          </button>
        </div>
        {showPat ? (
          <PatConnectForm workspaceId={workspaceId} projectId={projectId} />
        ) : null}
      </div>
    );
  }

  return (
    <ProjectPicker
      workspaceId={workspaceId}
      projectId={projectId}
      installs={gitlabInstalls}
    />
  );
}

function BeginOAuthButton({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">;
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
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect with GitLab"}
    </Button>
  );
}

/**
 * Lists projects from GitLab (paged + search) and lets the admin pick one to
 * link. Selection triggers `registerProject`, which creates the link and
 * registers the webhook in one server-side step.
 */
function ProjectPicker({
  workspaceId,
  projectId,
  installs,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  installs: InstallSummary[];
}) {
  const [activeAccount, setActiveAccount] = useState(
    installs[0]?.externalAccountId ?? "",
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // `projects: null` is "not yet fetched" — we render "Loading…" for it. On
  // re-fetch we leave the stale list visible (no flicker) until the new page
  // arrives. Loading flag derived from this rather than carried as separate
  // state to avoid the synchronous setState-in-effect anti-pattern.
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

  // Re-fetch when the active install / search / page changes. All state
  // updates happen inside the promise chain (never synchronously in the
  // effect body) per the React-doctor set-state-in-effect rule.
  useEffect(() => {
    if (!activeAccount) return;
    let cancelled = false;
    list({
      workspaceId,
      externalAccountId: activeAccount,
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
  }, [activeAccount, page, search, workspaceId, list]);

  const loading = projects === null;

  const accountOptions = useMemo(
    () =>
      installs.map((i) => (
        <option key={i.externalAccountId} value={i.externalAccountId}>
          {i.accountLogin}
        </option>
      )),
    [installs],
  );

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Pick a GitLab project to link</p>
        <BeginOAuthButton workspaceId={workspaceId} />
      </div>

      <div className="flex items-center gap-2">
        {installs.length > 1 ? (
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={activeAccount}
            onChange={(e) => {
              setActiveAccount(e.target.value);
              setPage(1);
            }}
          >
            {accountOptions}
          </select>
        ) : null}
        <Input
          placeholder="Search projects…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects found. You need Maintainer or higher to register webhooks.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate font-medium">
                  {p.pathWithNamespace}
                </span>
                {p.defaultBranch ? (
                  <span className="text-xs text-muted-foreground">
                    default: {p.defaultBranch}
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={linkingId !== null}
                onClick={() => {
                  setLinkingId(p.id);
                  register({
                    workspaceId,
                    projectId,
                    externalAccountId: activeAccount,
                    gitlabProjectId: p.id,
                    pathWithNamespace: p.pathWithNamespace,
                  })
                    .then(() => {
                      toast.success(`Linked ${p.pathWithNamespace}`, {
                        description: "Webhook registered on GitLab.",
                      });
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
                ) : (
                  "Link"
                )}
              </Button>
            </li>
          ))}
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
 * Legacy PAT form. The admin pastes an account name + token, we mark the
 * install complete, then they paste the URL + secret into the GitLab project
 * to register the webhook themselves. Surfaced as the advanced fallback when
 * OAuth isn't configured (self-hosted) or the user explicitly opts in.
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
        description: "Register the webhook below on your GitLab project.",
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
    <div className="rounded-md border p-4 space-y-3">
      <p className="text-sm font-medium">Connect with a personal access token</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="gl-account">Account / namespace</Label>
          <Input
            id="gl-account"
            placeholder="my-group"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gl-token">Access token</Label>
          <Input
            id="gl-token"
            type="password"
            placeholder="glpat-…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gl-path">Project path</Label>
          <Input
            id="gl-path"
            placeholder="my-group/my-project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gl-id">Project id (numeric)</Label>
          <Input
            id="gl-id"
            placeholder="123456"
            value={gitlabProjectId}
            onChange={(e) => setGitlabProjectId(e.target.value)}
          />
        </div>
      </div>
      <Button onClick={() => void connect()} disabled={busy} size="sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect project"}
      </Button>
    </div>
  );
}

/**
 * Renders a single GitLab link's webhook configuration (URL + per-link secret)
 * for the admin to register on the GitLab project. Reads `getLinkWebhookConfig`
 * — admin-gated — and renders nothing for non-GitLab links. With OAuth the
 * webhook is registered automatically, but we still show this for PAT installs
 * and for diagnostic reference.
 */
function GitlabLinkRow({ linkId }: { linkId: Id<"projectIntegrationLinks"> }) {
  const config = useQuery(api.integrations.core.links.getLinkWebhookConfig, {
    linkId,
  });
  if (config === undefined || config.provider !== "gitlab") return null;

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Could not copy ${label}`),
    );
  };

  return (
    <div className="rounded-md border p-4 space-y-3">
      <p className="text-sm font-medium">Webhook configuration</p>
      <p className="text-xs text-muted-foreground">
        Auto-registered when linking via OAuth. For PAT installs, add a webhook
        on your GitLab project (Settings → Webhooks) with the URL and secret
        below; trigger on Issues, Comments, and Merge request events.
      </p>
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
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
          {mask ? "•".repeat(Math.min(value.length, 24)) : value}
        </code>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
