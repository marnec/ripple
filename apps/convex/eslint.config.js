import globals from "globals";
import tseslint from "typescript-eslint";
import convexPlugin from "@convex-dev/eslint-plugin";

/**
 * `apps/convex` linted for what the type system cannot see: unbounded
 * `.collect()` inside a query, plus the `no-filter-in-query`,
 * `no-top-of-hour-crons` and `no-schema-import-cycle` rules added in plugin
 * 4.0.0.
 *
 * This exists because of `graph.getWorkspaceGraph`, which collected five whole
 * workspace-scoped tables inside a live subscription. Convex stops a query at
 * 32,000 documents scanned / 16 MiB read, so an unbounded collect is not a
 * slow query — it is a query that eventually throws and takes the page with it.
 * The lint step here was `tsc` only, so nothing flagged it.
 */
export default tseslint.config(
  {
    ignores: ["convex/_generated/**", "dist/**", ".convex/**"],
  },
  {
    files: ["convex/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@convex-dev": convexPlugin },
    rules: {
      "@convex-dev/no-collect-in-query": "error",
      // Added in plugin 4.0.0. All three start clean: the five sites that
      // tripped `no-filter-in-query` and `no-top-of-hour-crons` were either
      // fixed (the two `workspaceIntegrations` reads now use the
      // `by_workspace_provider` index) or carry an inline disable naming the
      // reason. There is no debt list for these — keep it that way.
      "@convex-dev/no-filter-in-query": "error",
      "@convex-dev/no-top-of-hour-crons": "error",
      "@convex-dev/no-schema-import-cycle": "error",
    },
  },
  {
    // ── Known debt: pre-existing unbounded collects ──────────────────
    // These 52 files tripped `no-collect-in-query` when the rule was first
    // switched on (176 sites). They are downgraded to a warning so the rule
    // holds the line on NEW code without blocking CI on a backlog that is its
    // own piece of work. Burn this list down; do not add to it.
    //
    // `convex/graph.ts` is on it deliberately — its five whole-table collects
    // are the defect that motivated the rule, and bounding them is a separate
    // change (the local-graph work), not a lint fix.
    files: [
      "convex/admin/invites.ts",
      "convex/admin/stats.ts",
      "convex/admin/users.ts",
      "convex/admin/workspaces.ts",
      "convex/calendarEvents.ts",
      "convex/callSessions.ts",
      "convex/channelMembers.ts",
      "convex/channelNotificationPreferences.ts",
      "convex/channels.ts",
      "convex/cycles.ts",
      "convex/dbTriggers.ts",
      "convex/diagrams.ts",
      "convex/documentBlockRefs.ts",
      "convex/documents.ts",
      "convex/edges.ts",
      "convex/favorites.ts",
      "convex/graph.ts",
      "convex/integrations/core/entitlements.ts",
      "convex/integrations/core/forceResyncQueries.ts",
      "convex/integrations/core/inboundRouting.ts",
      "convex/integrations/core/install.ts",
      "convex/integrations/core/links.ts",
      "convex/integrations/core/pullRequestLinks.ts",
      "convex/integrations/core/statusReconciliation.ts",
      "convex/integrations/core/syncIn.ts",
      "convex/integrations/core/syncInPullRequests.ts",
      "convex/integrations/core/taskExternalLink.ts",
      "convex/messageReactions.ts",
      "convex/migrations.ts",
      "convex/nodes.ts",
      "convex/notificationDelivery.ts",
      "convex/notificationSubscriptionSync.ts",
      "convex/projectNotificationPreferences.ts",
      "convex/projects.ts",
      "convex/pushSubscription.ts",
      "convex/shares.ts",
      "convex/spreadsheetCellRefs.ts",
      "convex/spreadsheets.ts",
      "convex/tagSync.ts",
      "convex/tags.ts",
      "convex/taskActivity.ts",
      "convex/taskComments.ts",
      "convex/taskImports.ts",
      "convex/taskStatuses.ts",
      "convex/tasks.ts",
      "convex/userDenormalizationSync.ts",
      "convex/utils/eventInvitees.ts",
      "convex/utils/eventNotifications.ts",
      "convex/workspaceInvites.ts",
      "convex/workspaceMembers.ts",
      "convex/workspaceSidebarData.ts",
      "convex/workspaces.ts",
    ],
    rules: {
      "@convex-dev/no-collect-in-query": "warn",
    },
  },
);
