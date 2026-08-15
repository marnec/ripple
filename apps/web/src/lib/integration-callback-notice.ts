/**
 * Reads the outcome flag the provider install callbacks put on the URL they
 * bounce the browser back to.
 *
 * Both callbacks (`/integrations/github/setup`,
 * `/integrations/gitlab/oauth/callback`) are browser navigations that always
 * redirect: success lands on the originating workspace's settings, failure on
 * `/workspaces?<provider>=error`. Failure is not exotic — the workspace not
 * having the provider capability enabled is the default state of every
 * workspace, and the install button is not gated on it — so without something
 * reading the flag the user completes an App install on github.com/gitlab.com,
 * gets dropped on the workspace list, and is given no reason to think anything
 * went wrong.
 *
 * Pure so the mapping is testable without a router: the component supplies
 * `window.location.search` and renders the notice.
 */

export interface IntegrationCallbackNotice {
  variant: "success" | "error";
  title: string;
  description?: string;
}

/** Query params the callbacks set. Stripped after the notice is shown. */
export const INTEGRATION_CALLBACK_PARAMS = [
  "github_install",
  "gitlab_oauth",
] as const;

const PROVIDER_LABEL: Record<(typeof INTEGRATION_CALLBACK_PARAMS)[number], string> =
  {
    github_install: "GitHub",
    gitlab_oauth: "GitLab",
  };

export function readIntegrationCallbackNotice(
  search: string,
): IntegrationCallbackNotice | null {
  const params = new URLSearchParams(search);
  for (const key of INTEGRATION_CALLBACK_PARAMS) {
    const value = params.get(key);
    if (value === "success") {
      return { variant: "success", title: `Connected to ${PROVIDER_LABEL[key]}` };
    }
    if (value === "error") {
      return {
        variant: "error",
        title: `${PROVIDER_LABEL[key]} connection did not complete`,
        // The failure the callback cannot recover from and the admin can: the
        // `<provider>_integration` capability is off, which is where every
        // workspace starts. The other causes (the account already belongs to
        // another workspace, you are no longer an admin here) are rarer, so
        // this points at the fix without claiming to know which one it was.
        description:
          "Check the integration capability is enabled in workspace settings, then try again.",
      };
    }
  }
  return null;
}
