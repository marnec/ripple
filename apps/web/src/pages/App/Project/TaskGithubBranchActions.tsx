import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { Check, GitBranchPlus, GitPullRequestCreate, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useTaskGithubLink } from "./useTaskGithubLink";

type Props = {
  taskId: Id<"tasks">;
  /** From `task.externalRefs[0]` — present only for an issue-linked task. */
  repoFullName: string | undefined;
  issueNumber: number | undefined;
  taskTitle: string;
};

/**
 * Branch/PR affordances for an issue-linked task's detail header:
 *  - no branch yet → "Create branch". When the project link asks each time
 *    (the default), the button opens a base-branch picker; otherwise it creates
 *    in one click off the project's configured default (or the repo default).
 *  - branch exists → open a prefilled "Create pull request" compare page
 *    (`Closes #N` in the body + the recorded base, so it links + automates).
 *
 * Self-gates to nothing for native or issue-deleted tasks.
 */
export function TaskGithubBranchActions({
  taskId,
  repoFullName,
  issueNumber,
  taskTitle,
}: Props) {
  const gh = useTaskGithubLink(taskId);
  const createBranch = useAction(
    api.integrations.github.branchesAction.createBranchForTask,
  );
  const [creating, setCreating] = useState(false);

  if (
    !gh.isLinked ||
    gh.issueDeleted ||
    !repoFullName ||
    issueNumber === undefined
  ) {
    return null;
  }

  const branch = gh.branchName;

  // Create the branch off `baseBranch` (omit → backend resolves the configured
  // or repo default). Shared by the one-click and picker paths.
  const runCreate = (baseBranch?: string) => {
    setCreating(true);
    return createBranch({ taskId, baseBranch })
      .then((res) => {
        toast.success(
          res.alreadyExisted ? "Branch already exists" : "Branch created",
          { description: `${res.branchName} (from ${res.baseBranch})` },
        );
      })
      .catch((err: unknown) => {
        toast.error("Couldn't create branch", {
          description: err instanceof Error ? err.message : "Please try again",
        });
      })
      .finally(() => setCreating(false));
  };

  // Compare against the recorded base when known so a Git Flow feature PR opens
  // against e.g. `develop` rather than always the repo default.
  const compareUrl = branch
    ? `https://github.com/${repoFullName}/compare/` +
      (gh.branchBaseRef
        ? `${encodeURIComponent(gh.branchBaseRef)}...${encodeURIComponent(branch)}`
        : encodeURIComponent(branch)) +
      `?expand=1&title=${encodeURIComponent(taskTitle)}` +
      `&body=${encodeURIComponent(`Closes #${issueNumber}`)}`
    : null;

  // Create PR is leftmost (appears once a branch exists); the create-branch
  // control follows it and disables in place once a branch has been created.
  const askEachTime = gh.branchSource?.askEachTime ?? true;

  return (
    <>
      {compareUrl && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Create pull request"
          onClick={() =>
            window.open(compareUrl, "_blank", "noopener,noreferrer")
          }
        >
          <GitPullRequestCreate className="h-4 w-4" />
        </Button>
      )}

      {branch ? (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          title={`Branch created: ${branch}`}
        >
          <GitBranchPlus className="h-4 w-4" />
        </Button>
      ) : askEachTime ? (
        <BranchSourcePicker
          taskId={taskId}
          creating={creating}
          branchSource={gh.branchSource}
          onCreate={runCreate}
        />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={creating}
          title="Create a branch for this issue"
          onClick={() => void runCreate()}
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitBranchPlus className="h-4 w-4" />
          )}
        </Button>
      )}
    </>
  );
}

type PickerProps = {
  taskId: Id<"tasks">;
  creating: boolean;
  branchSource: ReturnType<typeof useTaskGithubLink>["branchSource"];
  onCreate: (baseBranch?: string) => Promise<unknown>;
};

/**
 * Popover menu that lists the repo's branches and creates the task branch off
 * the chosen one. Admins also get a "set as default & don't ask again" toggle
 * that persists the picked branch as the project default and silences future
 * prompts (a project-wide, admin-managed setting).
 */
function BranchSourcePicker({
  taskId,
  creating,
  branchSource,
  onCreate,
}: PickerProps) {
  const listBranches = useAction(
    api.integrations.github.branchesAction.listTaskRepoBranches,
  );
  const setDefaults = useMutation(
    api.integrations.core.links.setBranchSourceDefaults,
  );

  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [repoDefault, setRepoDefault] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [setAsDefault, setSetAsDefault] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listBranches({ taskId })
      .then((res) => {
        if (cancelled) return;
        setBranches(res.branches);
        setRepoDefault(res.defaultBranch);
      })
      .catch(() => {
        /* leave empty — free-text entry still works via the search box */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, listBranches]);

  // Reset to a loading state when (re)opening — done here in the event handler,
  // not the effect, so we never call setState synchronously during an effect.
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      setLoading(true);
      setQuery("");
      setSetAsDefault(false);
    }
  };

  const configuredDefault = branchSource?.configuredDefault ?? null;
  const canManageDefault = branchSource?.canManageDefault ?? false;
  const projectLinkId = branchSource?.projectLinkId;

  const pick = (baseBranch: string) => {
    setOpen(false);
    void onCreate(baseBranch).then(() => {
      if (setAsDefault && canManageDefault && projectLinkId) {
        void setDefaults({
          linkId: projectLinkId,
          defaultBaseBranch: baseBranch,
          askEachTime: false,
        }).catch(() => {
          toast.error("Branch created, but couldn't save the default");
        });
      }
    });
  };

  // Offer the typed value as an explicit choice when it isn't an existing
  // branch (a not-yet-pushed base can still be branched from).
  const typed = query.trim();
  const showTyped = typed !== "" && !branches.includes(typed);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={creating}
            title="Create a branch for this issue"
            type="button"
          />
        }
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GitBranchPlus className="h-4 w-4" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command shouldFilter>
          <CommandInput
            placeholder="Branch from…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>No matching branches.</CommandEmpty>
                {showTyped && (
                  <CommandGroup>
                    <CommandItem
                      value={typed}
                      onSelect={() => pick(typed)}
                      className="font-mono text-xs"
                    >
                      Branch from “{typed}”
                    </CommandItem>
                  </CommandGroup>
                )}
                <CommandGroup heading="Branches">
                  {branches.map((b) => (
                    <CommandItem
                      key={b}
                      value={b}
                      onSelect={() => pick(b)}
                      className="font-mono text-xs"
                    >
                      <span className="truncate">{b}</span>
                      {b === repoDefault && (
                        <span className="ml-1.5 shrink-0 font-sans text-[10px] text-muted-foreground">
                          default
                        </span>
                      )}
                      {b === configuredDefault && (
                        <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          {canManageDefault && (
            <label className="flex items-center gap-2 border-t px-3 py-2.5 text-xs text-muted-foreground">
              <Checkbox
                checked={setAsDefault}
                onCheckedChange={(c) => setSetAsDefault(c === true)}
              />
              Set as project default &amp; don&apos;t ask again
            </label>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
