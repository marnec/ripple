import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

/** Query param the setup callback appends when it parks a candidate list. */
export const CONNECT_PARAM = "github_connect";

/**
 * Account picker for the "connect an installation that already exists" flow.
 *
 * The provider redirect lands back on whichever page started the flow with
 * `?github_connect=<token>`; this reads that token, shows the accounts the user
 * proved they can reach, and connects the chosen one. Mount it on any page that
 * can start the flow — it renders nothing without the param.
 *
 * Deliberately not GitHub-specific beyond the param name: the backend list is
 * provider-tagged, so the copy follows whatever produced it.
 */
export function IntegrationAccountPicker() {
  const [params, setParams] = useSearchParams();
  const token = params.get(CONNECT_PARAM);

  const parked = useQuery(
    api.integrations.core.install.listInstallCandidates,
    token ? { token } : "skip",
  );
  const claim = useMutation(api.integrations.core.install.claimInstallation);
  const [busy, setBusy] = useState(false);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete(CONNECT_PARAM);
    setParams(next, { replace: true });
  };

  // No token, still loading, or a token that isn't ours / has expired.
  if (!token || parked === undefined) return null;
  if (parked === null) return null;

  const providerLabel = parked.provider === "gitlab" ? "GitLab" : "GitHub";

  const connect = async (externalAccountId: string, label: string) => {
    setBusy(true);
    try {
      await claim({ token, externalAccountId });
      toast.success(`Connected ${label}`);
      close();
    } catch (err) {
      toast.error("Could not connect account", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Choose a {providerLabel} account
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            These are the accounts you can reach. Connecting one lets this
            workspace link its repositories.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ul className="space-y-1 px-4 pb-2 md:px-0">
          {parked.candidates.map((c) => {
            const label = c.accountLogin ?? c.externalAccountId;
            const connected = parked.alreadyConnected.includes(
              c.externalAccountId,
            );
            return (
              <li key={c.externalAccountId}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={busy || connected}
                  onClick={() => void connect(c.externalAccountId, label)}
                >
                  <span className="truncate">{label}</span>
                  {c.accountType && (
                    <span className="text-xs text-muted-foreground">
                      ({c.accountType})
                    </span>
                  )}
                  {connected && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      already connected
                    </span>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
