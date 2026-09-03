/**
 * Reads the outcome flag the provider callbacks put on the URL they bounce the
 * browser back to.
 *
 * Both callbacks (`/integrations/github/setup`,
 * `/integrations/gitlab/oauth/callback`) are browser navigations that always
 * redirect. Two round trips share each of them, told apart by the nonce's
 * purpose on the server and by the flag name here:
 *
 * - **Install** (`github_install`, `gitlab_oauth`): an admin binding a provider
 *   account to the workspace. Success lands on the workspace's settings,
 *   failure on `/workspaces?<flag>=error`. Failure is not exotic — the
 *   workspace not having the provider capability enabled is the default state
 *   of every workspace, and the install button is not gated on it — so without
 *   something reading the flag the user completes an App install on
 *   github.com/gitlab.com, gets dropped on the workspace list, and is given no
 *   reason to think anything went wrong.
 * - **Identity** (`github_identity`, `gitlab_identity`): a member proving which
 *   provider user they are, from user settings. Success lands back wherever
 *   they started, failure on `/workspaces`. The capability has nothing to do
 *   with it, so its error copy must not point there.
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
  "github_identity",
  "gitlab_identity",
] as const;

type CallbackParam = (typeof INTEGRATION_CALLBACK_PARAMS)[number];

const NOTICE: Record<
  CallbackParam,
  { success: IntegrationCallbackNotice; error: IntegrationCallbackNotice }
> = {
  github_install: installNotice("GitHub"),
  gitlab_oauth: installNotice("GitLab"),
  github_identity: identityNotice("GitHub"),
  gitlab_identity: identityNotice("GitLab"),
};

function installNotice(provider: string) {
  return {
    success: { variant: "success", title: `Connected to ${provider}` },
    error: {
      variant: "error",
      title: `${provider} connection did not complete`,
      // The failure the callback cannot recover from and the admin can: the
      // `<provider>_integration` capability is off, which is where every
      // workspace starts. The other causes (the account already belongs to
      // another workspace, you are no longer an admin here) are rarer, so
      // this points at the fix without claiming to know which one it was.
      description:
        "Check the integration capability is enabled in workspace settings, then try again.",
    },
  } as const;
}

function identityNotice(provider: string) {
  return {
    success: { variant: "success", title: `${provider} account connected` },
    error: {
      variant: "error",
      title: `Couldn't connect your ${provider} account`,
      // The one cause the user can act on: the account is already connected
      // to a different Ripple user (the server refuses rather than unmapping
      // both). Everything else is transient.
      description: `If that ${provider} account is already connected to another Ripple user, disconnect it there first.`,
    },
  } as const;
}

export function readIntegrationCallbackNotice(
  search: string,
): IntegrationCallbackNotice | null {
  const params = new URLSearchParams(search);
  for (const key of INTEGRATION_CALLBACK_PARAMS) {
    const value = params.get(key);
    if (value === "success") return NOTICE[key].success;
    if (value === "error") return NOTICE[key].error;
  }
  return null;
}
