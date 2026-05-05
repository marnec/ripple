import { type ReactNode } from "react";
import { Share2 } from "lucide-react";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";

export interface DownloadItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface ResourceActionsMenuProps {
  /** Download menu entries. Required — the menu always offers downloads.
   *  (Share is admin-gated separately via `onShare`.) */
  downloadItems: readonly DownloadItem[];
  /** Show the "Share…" item and call this when selected. Omit to hide
   *  the share entry (e.g. for non-admin viewers). */
  onShare?: () => void;
  /** Optional ShareDialog (or other side-effecting node) that the parent
   *  controls. Mounted alongside the menu so opening state lives with the
   *  caller. */
  shareDialog?: ReactNode;
  /** Trigger button label/title attribute. */
  triggerTitle?: string;
}

export function ResourceActionsMenu({
  downloadItems,
  onShare,
  shareDialog,
  triggerTitle = "Share & download",
}: ResourceActionsMenuProps) {
  return (
    <>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title={triggerTitle}
            >
              <Share2 className="size-4" />
            </button>
          }
        />
        <ResponsiveDropdownMenuContent align="end" className="w-52 rounded-lg">
          {onShare && (
            <>
              <ResponsiveDropdownMenuItem onSelect={onShare}>
                <Share2 className="text-muted-foreground" />
                <span>Share…</span>
              </ResponsiveDropdownMenuItem>
              <ResponsiveDropdownMenuSeparator />
            </>
          )}
          {downloadItems.map((item) => (
            <ResponsiveDropdownMenuItem key={item.label} onSelect={item.onSelect}>
              {item.icon}
              <span>Download as {item.label}</span>
            </ResponsiveDropdownMenuItem>
          ))}
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
      {shareDialog}
    </>
  );
}

