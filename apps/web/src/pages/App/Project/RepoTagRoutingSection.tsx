import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";
import { GitBranch } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Separator } from "@/components/ui/separator";
import { TagPills } from "@/components/TagPills";

type Props = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
};

/**
 * Tag→repo routing config, shown only when a project has more than one active
 * connected repo. Laid out by repo: each connected repo lists the tags routed
 * to it as pills, with an inline "+ tag" button to add one. When an issue is
 * created from a task whose tags match exactly one repo, that repo is
 * preselected (`pickRepoForTags`); tags spanning repos preselect nothing.
 *
 * A tag belongs to at most one repo: the add popover hides tags already routed
 * elsewhere, and each edit is one atomic `setTagRoutingRule` (the mutation
 * strips the tag from any other repo as it assigns it).
 */
export function RepoTagRoutingSection({ projectId, workspaceId }: Props) {
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });
  const setTagRoutingRule = useMutation(
    api.integrations.core.links.setTagRoutingRule,
  );

  const activeLinks = (links ?? []).filter(
    (l) => l.status === "active" && !l.pausedByBilling,
  );

  // Routing only matters when there's a choice of repo to route to.
  if (activeLinks.length < 2) return null;

  // Every tag routed anywhere — hidden from each repo's add popover so a tag
  // can't be claimed by two repos (move = remove here, add there).
  const routedTags = new Set(activeLinks.flatMap((l) => l.autoSelectTags ?? []));

  const apply = (tag: string, linkId: Id<"projectIntegrationLinks"> | null) => {
    setTagRoutingRule({ projectId, tag, linkId }).catch((err: unknown) => {
      toast.error("Couldn't update tag routing", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    });
  };

  return (
    <>
      <Separator className="my-6" />
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">Tag routing</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Assign tags to a repository to preselect it when you create an issue
          from a tagged task. A tag can belong to only one repository; a task
          whose tags span repositories preselects none.
        </p>

        <div className="divide-y rounded-md border">
          {activeLinks.map((link) => (
            <div
              key={link._id}
              className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="flex shrink-0 items-center gap-2 sm:w-2/5 sm:pt-0.5">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">
                  {link.externalRepoFullName}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <TagPills
                  workspaceId={workspaceId}
                  value={link.autoSelectTags ?? []}
                  onAdd={(tag) => apply(tag, link._id)}
                  onRemove={(tag) => apply(tag, null)}
                  excludedFromAdd={routedTags}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
