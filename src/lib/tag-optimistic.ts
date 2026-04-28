import type { OptimisticUpdate } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Optimistic-update factory for `<resource>.updateTags` mutations.
// Returns the callback to pass to `useMutation(...).withOptimisticUpdate(...)`.
// Patches both the resource document's `tags` array AND the workspace tag
// dictionary so a freshly-created tag shows up immediately in autocomplete
// and the picker popover.

type ResourceQueryRef = FunctionReference<
  "query",
  "public",
  { id: string },
  { workspaceId: Id<"workspaces">; tags?: string[] } | null
>;

export function tagsOptimisticUpdate(
  getResourceRef: ResourceQueryRef,
): OptimisticUpdate<{ id: string; tags: string[] }> {
  return (localStore, { id, tags }) => {
    const resource = localStore.getQuery(getResourceRef, { id });
    if (!resource) return;
    localStore.setQuery(getResourceRef, { id }, { ...resource, tags });

    const dict = localStore.getQuery(api.tags.listWorkspaceTags, {
      workspaceId: resource.workspaceId,
    });
    if (dict) {
      const merged = Array.from(new Set([...dict, ...tags])).sort();
      localStore.setQuery(
        api.tags.listWorkspaceTags,
        { workspaceId: resource.workspaceId },
        merged,
      );
    }
  };
}
