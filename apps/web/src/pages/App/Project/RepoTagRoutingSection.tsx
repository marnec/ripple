import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";
import { GitBranch } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Separator } from "@/components/ui/separator";
import { TagInput } from "@/components/TagInput";

type Props = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
};

/**
 * Tag→repo routing config, shown only when a project has more than one active
 * connected repo. Each repo gets a tag set; when an issue is created from a task
 * whose tags match exactly one repo's set, that repo is preselected in the
 * create-issue dialog (`pickRepoForTags`). A tag belongs to at most one repo —
 * `setRepoTagRules` rejects assigning a tag already claimed by another repo, so
 * the dialog's single-repo match stays unambiguous. Admin-only mutation; the
 * section is mounted inside the creator-only block of project settings.
 */
export function RepoTagRoutingSection({ projectId, workspaceId }: Props) {
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });
  const setRepoTagRules = useMutation(
    api.integrations.core.links.setRepoTagRules,
  );

  const activeLinks = (links ?? []).filter(
    (l) => l.status === "active" && !l.pausedByBilling,
  );

  // Routing only matters when there's a choice of repo to route to.
  if (activeLinks.length < 2) return null;

  const save = (linkId: Id<"projectIntegrationLinks">, tags: string[]) => {
    setRepoTagRules({ linkId, tags }).catch((err: unknown) => {
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
          Associate tags with a repository to preselect it when creating an issue
          from a tagged task. A tag can route to only one repository; if a task&apos;s
          tags point to different repositories, no repository is preselected.
        </p>
        <div className="space-y-4">
          {activeLinks.map((link) => (
            <div key={link._id} className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">
                  {link.externalRepoFullName}
                </span>
              </div>
              <TagInput
                value={link.autoSelectTags ?? []}
                onChange={(tags) => save(link._id, tags)}
                workspaceId={workspaceId}
                placeholder="Add a tag to route here…"
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
