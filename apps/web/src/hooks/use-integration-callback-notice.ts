import { useEffect } from "react";
import { toast } from "sonner";
import {
  INTEGRATION_CALLBACK_PARAMS,
  readIntegrationCallbackNotice,
} from "@/lib/integration-callback-notice";

/**
 * Toast the outcome a provider callback put on the URL, then strip its flag so
 * a reload does not re-toast.
 *
 * Mounted in two places because the callbacks land in two places: a failed
 * round trip (install or identity) always lands on `/workspaces`, while a
 * completed one lands on the workspace settings (install) or wherever the
 * member started from (identity) — both inside the workspace shell.
 */
export function useIntegrationCallbackNotice() {
  useEffect(() => {
    const notice = readIntegrationCallbackNotice(window.location.search);
    if (!notice) return;
    if (notice.variant === "success") toast.success(notice.title, { description: notice.description });
    else toast.error(notice.title, { description: notice.description });

    const params = new URLSearchParams(window.location.search);
    for (const key of INTEGRATION_CALLBACK_PARAMS) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);
}
