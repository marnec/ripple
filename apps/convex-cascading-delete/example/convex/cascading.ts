/*
(1.) Cascade delete configuration for example application
(2.) Defines relationship graph for five-level organizational hierarchy
(3.) Exports configured CascadingDelete instance and batch handler

This module configures the cascading delete rules for the example application's
organizational structure. The rules define how deletions propagate through the
hierarchy: deleting an organization cascades to teams, which cascade to both
members and projects, which cascade to tasks, which cascade to comments. The
configuration demonstrates both linear cascades and branching cascades where
a single parent table has multiple dependent tables. The batch handler is
exported as an internal mutation for use in batched deletion operations.
*/

import { CascadingDelete, defineCascadeRules, makeBatchDeleteHandler } from "@00akshatsinha00/convex-cascading-delete";
import { components } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

export const cascadeRules = defineCascadeRules({
  organizations: [
    { to: "teams", via: "byOrganizationId", field: "organizationId" },
  ],
  teams: [
    { to: "members", via: "byTeamId", field: "teamId" },
    { to: "projects", via: "byTeamId", field: "teamId" },
  ],
  projects: [
    { to: "tasks", via: "byProjectId", field: "projectId" },
  ],
  tasks: [
    { to: "comments", via: "byTaskId", field: "taskId" },
  ],
});

export const cd = new CascadingDelete(components.convexCascadingDelete, {
  rules: cascadeRules,
});

export const _cascadeBatchHandler = makeBatchDeleteHandler(
  internalMutation,
  components.convexCascadingDelete
);
