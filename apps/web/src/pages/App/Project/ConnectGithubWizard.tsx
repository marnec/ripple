import { Button } from "@ripple/ui/components/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ripple/ui/components/dialog";
import { Input } from "@ripple/ui/components/input";
import { Label } from "@/components/ui/label";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
import { toast } from "sonner";
import { GitBranch, Inbox, Loader2, Search } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { IntegrationCardShell } from "./IntegrationCardShell";
import { WizardStepper } from "./WizardStepper";

const GITHUB_FEATURE_KEY = "github_integration";

type Props = {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

/**
 * GitHub variant of the shared integration card: the shell owns the gating,
 * the linked rows and the disconnect flow; this only supplies the provider
 * copy and the import wizard.
 */
export function ConnectGithubCard({ workspaceId, projectId }: Props) {
  return (
    <IntegrationCardShell
      workspaceId={workspaceId}
      projectId={projectId}
      featureKey={GITHUB_FEATURE_KEY}
      copy={{
        provider: "github",
        title: "GitHub",
        noun: "repository",
        shortNoun: "repo",
      }}
      renderWizard={({ open, onOpenChange }) => (
        <ConnectGithubWizard
          workspaceId={workspaceId}
          projectId={projectId}
          open={open}
          onOpenChange={onOpenChange}
        />
      )}
    />
  );
}

type Step = "account" | "repo" | "filter" | "preview";

const WIZARD_STEPS = [
  { key: "account", label: "Account" },
  { key: "repo", label: "Repository" },
  { key: "filter", label: "Filter" },
  { key: "preview", label: "Review" },
] as const satisfies readonly { key: Step; label: string }[];

type Repo = { externalRepoId: string; fullName: string; private: boolean };

function ConnectGithubWizard({
  workspaceId,
  projectId,
  open,
  onOpenChange,
}: Props & { open: boolean; onOpenChange: (v: boolean) => void }) {
  // Provider-scoped: a workspace can hold a GitHub and a GitLab account with
  // the same login, and an unfiltered list showed both as identical rows here.
  const installations = useQuery(
    api.integrations.core.install.listInstallations,
    open ? { workspaceId, provider: "github" } : "skip",
  );
  const statuses = useQuery(
    api.taskStatuses.listByProject,
    open ? { projectId } : "skip",
  );
  const beginInstall = useMutation(
    api.integrations.core.installFlow.beginAppInstall,
  );
  const beginAuthorize = useMutation(
    api.integrations.core.installFlow.beginAppAuthorize,
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

  const handleConnectExisting = async () => {
    try {
      const { url } = await beginAuthorize({
        workspaceId,
        // Come back to this project's settings so the picker opens where the
        // flow started, rather than dumping the user in workspace settings.
        // Projects nest under the workspace shell — a bare `/projects/:id`
        // matches no route.
        returnTo: `/workspaces/${workspaceId}/projects/${projectId}/settings`,
      });
      window.location.href = url;
    } catch (err) {
      toast.error("Could not start GitHub authorization", {
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

        <WizardStepper steps={WIZARD_STEPS} current={step} />

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
            {/*
              GitHub only shows an install screen for accounts the app is NOT
              already on — otherwise it redirects to that installation's own
              settings page and never comes back. This is the way in for an
              account it is already installed on.
            */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleConnectExisting()}
              className="w-full"
            >
              Connect an account it's already installed on
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
