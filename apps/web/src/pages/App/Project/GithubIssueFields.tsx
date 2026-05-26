import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitBranch } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import type { ActiveRepoLink } from "./useGithubIssueEligibility";
import type { GithubIssueDraft } from "./useGithubIssueDraft";

type Props = {
  draft: GithubIssueDraft;
  links: ActiveRepoLink[];
  disabled?: boolean;
};

/**
 * Presentational fields for the create-issue draft: issue title + target repo.
 * The repo picker collapses to a static label when only one repo is connected.
 */
export function GithubIssueFields({ draft, links, disabled }: Props) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="gh-issue-title" className="text-xs">
          Issue title
        </Label>
        <Input
          id="gh-issue-title"
          value={draft.title}
          placeholder="Issue title"
          disabled={disabled}
          onChange={(e) => draft.setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Repository</Label>
        {links.length === 1 ? (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs">
              {links[0].externalRepoFullName}
            </span>
          </div>
        ) : (
          <Select
            value={draft.repoLinkId ?? undefined}
            disabled={disabled}
            onValueChange={(v) =>
              draft.setRepoLinkId(v as Id<"projectIntegrationLinks">)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a repository">
                {(value) =>
                  links.find((l) => l._id === value)?.externalRepoFullName ??
                  "Choose a repository"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {links.map((l) => (
                <SelectItem key={l._id} value={l._id}>
                  <span className="font-mono text-xs">
                    {l.externalRepoFullName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
