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
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useState } from "react";
import { toast } from "sonner";
import { GitBranch, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const GITHUB_FEATURE_KEY = "github_integration";

type Props = {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

/**
 * Project-settings entry point for connecting a GitHub repo. Capability-gated:
 * when the workspace lacks the `github_integration` entitlement, renders a
 * muted card pointing admins at workspace settings instead of the wizard.
 */
export function ConnectGithubCard({ workspaceId, projectId }: Props) {
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITHUB_FEATURE_KEY },
  );
  const [open, setOpen] = useState(false);

  if (feature === undefined) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1">GitHub</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect a GitHub repository so issues sync with this project.
      </p>
      {feature.enabled ? (
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
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          The GitHub integration is disabled for this workspace. A workspace
          admin can enable it under Workspace Settings → Integrations.
        </div>
      )}
    </section>
  );
}

type Step = "account" | "repo" | "gate" | "filter" | "preview";

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
  const gate = useQuery(
    api.integrations.core.activationGate.canActivate,
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
  const [repo, setRepo] = useState<Repo | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [labelsText, setLabelsText] = useState("");
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = labelsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const reset = () => {
    setStep("account");
    setAccountId(null);
    setRepos(null);
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
    setStep(gate?.canActivate ? "filter" : "gate");
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
        description: "Importing issues into triage…",
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
            {step === "gate" && "This project isn't ready yet."}
            {step === "filter" && "Choose which issues to import."}
            {step === "preview" && "Review and confirm the import."}
          </DialogDescription>
        </DialogHeader>

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
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {repos?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No repositories accessible to this installation.
              </p>
            ) : (
              repos?.map((r) => (
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
        )}

        {step === "gate" && (
          <div className="rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900">
            This project has no <strong>triage</strong> status, which is where
            imported issues land. Add a triage status to the project board, then
            reopen this wizard.
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
              About to import{" "}
              <strong>{previewTotal}</strong>{" "}
              issue{previewTotal === 1 ? "" : "s"} from{" "}
              <span className="font-mono">{repo?.fullName}</span> into this
              project's triage status.
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
