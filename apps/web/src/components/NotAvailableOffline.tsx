import { CloudOff } from "lucide-react";

const RESOURCE_LABEL = {
  document: "document",
  diagram: "diagram",
  spreadsheet: "spreadsheet",
  description: "description",
} as const;

export type OfflineResource = keyof typeof RESOURCE_LABEL;

/**
 * What a collaborative surface shows when this device has never held the
 * resource's contents and cannot reach anything that has them.
 *
 * The alternative — an empty editor — is not a gentler version of this screen.
 * It is a claim that the resource is empty, and acting on that claim (typing)
 * costs the real contents on reconnect. So the honest empty-handed state is
 * also the safe one.
 */
export function NotAvailableOffline({
  resource,
  compact = false,
}: {
  resource: OfflineResource;
  /** Inline variant, for a panel rather than a page (the task sheet). */
  compact?: boolean;
}) {
  const label = RESOURCE_LABEL[resource];

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground animate-fade-in">
        <CloudOff className="size-4 shrink-0" />
        <span>This {label} hasn&apos;t been opened on this device yet, so it isn&apos;t available offline.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center animate-fade-in">
      <CloudOff className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">This {label} isn&apos;t available offline</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        You haven&apos;t opened it on this device before, so there&apos;s no local copy to
        show. It will load as soon as you&apos;re back online.
      </p>
    </div>
  );
}
