import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
import { toast } from "sonner";
import { GitBranch, Inbox, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BranchStatusMapEditor } from "../Workspace/BranchStatusMapEditor";
import { BranchSourceDefaultsEditor } from "../Workspace/BranchSourceDefaultsEditor";

const GITHUB_FEATURE_KEY = "github_integration";

type Props = {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

/**
 * Project-settings entry point for connecting a GitHub repo. Two gates guard
 * the wizard, both surfaced *before* it opens so users never invest effort
 * picking a repo only to be blocked:
 *  - capability: workspace must hold the `github_integration` entitlement.
 *  - prerequisite: project must have a triage (issue-inbox) status, set via
 *    the Status Effect Matrix on this same page.
 */
export function ConnectGithubCard({ workspaceId, projectId }: Props) {
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITHUB_FEATURE_KEY },
  );
  const gate = useQuery(api.integrations.core.activationGate.canActivate, {
    projectId,
  });
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });
  const unlink = useMutation(api.integrations.core.links.unlinkLink);
  const [open, setOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] =
    useState<Id<"projectIntegrationLinks"> | null>(null);

  if (feature === undefined) return null;

  const ready = gate?.canActivate === true;
  const activeLinks = links ?? [];

  const handleDisconnect = async (
    linkId: Id<"projectIntegrationLinks">,
    repo: string,
  ) => {
    if (
      !confirm(
        `Disconnect ${repo}? Synced issues stay, but new GitHub activity will no longer update this project.`,
      )
    ) {
      return;
    }
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
      <h2 className="text-lg font-semibold mb-1">GitHub</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect a GitHub repository so issues sync with this project.
      </p>

      {!feature.enabled ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          The GitHub integration is disabled for this workspace. A workspace
          admin can enable it under Workspace Settings → Integrations.
        </div>
      ) : activeLinks.length > 0 ? (
        <div className="space-y-2">
          {activeLinks.map((link) => (
            <div
              key={link._id}
              className="space-y-2 rounded-md border px-3 py-2.5"
            >
              <div className="flex items-center gap-3 text-sm">
                <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">
                  {link.externalRepoFullName}
                </span>
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
                  disabled={disconnectingId === link._id}
                  onClick={() =>
                    void handleDisconnect(link._id, link.externalRepoFullName)
                  }
                >
                  {disconnectingId === link._id && (
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
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Resync lives under Workspace Settings → Integrations.
          </p>
        </div>
      ) : !ready ? (
        <div className="space-y-3">
          <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/30">
            <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="space-y-2 text-sm text-amber-900 dark:text-amber-200">
              <p>
                Before connecting, choose where imported issues should land.
                GitHub issues import into an <strong>issue-inbox</strong> status,
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
            </div>
          </div>
          <Button variant="outline" className="gap-2" disabled>
            <GitBranch className="h-4 w-4" />
            Connect GitHub repo
          </Button>
        </div>
      ) : (
        <>
          <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
            <GitBranch className="h-4 w-4" />
            Connect GitHub repo
          </Button>
          <ConnectGithubWizard
            workspaceId={workspaceId}
            projectId={projectId}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      )}
    </section>
  );
}

/**
 * Admin toggle for inbound issue/comment auto-sync (GitHub → Ripple). When off,
 * the project stops auto-pulling issue changes; PR sync and outbound push keep
 * working. The Switch reflects the link state reactively.
 */
function InboundIssueSyncToggle({
  linkId,
  disabled,
}: {
  linkId: Id<"projectIntegrationLinks">;
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
        Pull issue changes from GitHub
      </span>
      <Switch checked={!disabled} onCheckedChange={onToggle} />
    </label>
  );
}

type Step = "account" | "repo" | "filter" | "preview";

const STEP_ORDER: Step[] = ["account", "repo", "filter", "preview"];
const STEP_LABELS: Record<Step, string> = {
  account: "Account",
  repo: "Repository",
  filter: "Filter",
  preview: "Review",
};

type Repo = { externalRepoId: string; fullName: string; private: boolean };

function ConnectGithubWizard({
  workspaceId,
  projectId,
  open,
  onOpenChange,
}: Props & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const installations = useQuery(
    api.integrations.core.install.listInstallations,
    open ? { workspaceId } : "skip",
  );
  const statuses = useQuery(
    api.taskStatuses.listByProject,
    open ? { projectId } : "skip",
  );
  const beginInstall = useMutation(
    api.integrations.core.installFlow.beginAppInstall,
  );
  const listRepos = useAction(
    api.integrations.github.wizardActions.listInstallationRepos,
  );
  const previewCount = useAction(
    api.integrations.github.wizardActions.previewImportCount,
  );
  const createLink = useMutation(api.integrations.core.links.createLink);
  const startImport = useMutation(
    api.integrations.github.importStart.startGithubImport,
  );

  const [step, setStep] = useState<Step>("account");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [repo, setRepo] = useState<Repo | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [labelsText, setLabelsText] = useState("");
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const triageName = statuses?.find((s) => s.isTriage)?.name ?? "triage";

  const labels = labelsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const filteredRepos = repos?.filter((r) =>
    r.fullName.toLowerCase().includes(repoQuery.trim().toLowerCase()),
  );

  const reset = () => {
    setStep("account");
    setAccountId(null);
    setRepos(null);
    setRepoQuery("");
    setRepo(null);
    setIncludeClosed(false);
    setLabelsText("");
    setPreviewTotal(null);
    setBusy(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handlePickAccount = async (externalAccountId: string) => {
    setAccountId(externalAccountId);
    setBusy(true);
    try {
      const result = await listRepos({ workspaceId, externalAccountId });
      setRepos(result);
      setStep("repo");
    } catch (err) {
      toast.error("Could not load repositories", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAddAccount = async () => {
    try {
      const { url } = await beginInstall({ workspaceId });
      window.location.href = url;
    } catch (err) {
      toast.error("Could not start GitHub install", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    }
  };

  const handlePickRepo = (r: Repo) => {
    setRepo(r);
    setStep("filter");
  };

  const handlePreview = async () => {
    if (!accountId || !repo) return;
    setBusy(true);
    try {
      const { count } = await previewCount({
        workspaceId,
        externalAccountId: accountId,
        repoFullName: repo.fullName,
        includeClosed,
        labels,
      });
      setPreviewTotal(count);
      setStep("preview");
    } catch (err) {
      toast.error("Could not preview import", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async () => {
    if (!accountId || !repo) return;
    setBusy(true);
    try {
      const linkId = await createLink({
        projectId,
        workspaceId,
        externalAccountId: accountId,
        externalRepoId: repo.externalRepoId,
        externalRepoFullName: repo.fullName,
      });
      await startImport({
        projectIntegrationLinkId: linkId,
        includeClosed,
        labels,
        expectedTotal: previewTotal ?? 0,
      });
      toast.success(`Connected ${repo.fullName}`, {
        description: `Importing issues into ${triageName}…`,
      });
      handleOpenChange(false);
    } catch (err) {
      toast.error("Could not connect repository", {
        description: err instanceof Error ? err.message : "Please try again",
      });
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect GitHub repo</DialogTitle>
          <DialogDescription>
            {step === "account" && "Choose the GitHub account to import from."}
            {step === "repo" && "Choose a repository to link to this project."}
            {step === "filter" && "Choose which issues to import."}
            {step === "preview" && "Review and confirm the import."}
          </DialogDescription>
        </DialogHeader>

        <Stepper current={step} />

        {step === "account" && (
          <div className="space-y-2">
            {installations === undefined ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : installations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No GitHub accounts installed yet.
              </p>
            ) : (
              installations.map((inst) => (
                <button
                  key={inst._id}
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePickAccount(inst.externalAccountId)}
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <GitBranch className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {inst.accountLogin ?? inst.externalAccountId}
                  </span>
                  {inst.externalAccountType && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {inst.externalAccountType}
                    </span>
                  )}
                </button>
              ))
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleAddAccount()}
              className="w-full"
            >
              + Install on another account
            </Button>
          </div>
        )}

        {step === "repo" && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={repoQuery}
                onChange={(e) => setRepoQuery(e.target.value)}
                placeholder="Filter repositories…"
                className="pl-8"
                autoFocus
              />
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {filteredRepos?.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {repos?.length === 0
                    ? "No repositories accessible to this installation."
                    : "No repositories match your search."}
                </p>
              ) : (
                filteredRepos?.map((r) => (
                  <button
                    key={r.externalRepoId}
                    type="button"
                    onClick={() => handlePickRepo(r)}
                    className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate font-mono">{r.fullName}</span>
                    {r.private && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        private
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {step === "filter" && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeClosed}
                onCheckedChange={(c) => setIncludeClosed(c === true)}
              />
              Include closed issues
            </label>
            <div className="space-y-2">
              <Label htmlFor="labels">Labels (optional, comma-separated)</Label>
              <Input
                id="labels"
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                placeholder="bug, enhancement"
              />
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="text-sm">
            <p>
              About to import <strong>{previewTotal}</strong> issue
              {previewTotal === 1 ? "" : "s"} from{" "}
              <span className="font-mono">{repo?.fullName}</span> into{" "}
              <span className="inline-flex items-center gap-1 font-medium">
                <Inbox className="h-3.5 w-3.5" />
                {triageName}
              </span>
              .
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "repo" && (
            <Button variant="ghost" onClick={() => setStep("account")}>
              Back
            </Button>
          )}
          {step === "filter" && (
            <>
              <Button variant="ghost" onClick={() => setStep("repo")}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => void handlePreview()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Preview
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => setStep("filter")}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => void handleActivate()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect &amp; import
              </Button>
            </>
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
                !active && !done && "border-muted-foreground/30 text-muted-foreground",
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
