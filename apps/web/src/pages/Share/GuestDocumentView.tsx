import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { withCollaboration } from "@blocknote/core/yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import { documentSchema } from "@/pages/App/Document/schema";
import { NotAvailableOffline } from "@/components/NotAvailableOffline";
import { useGuestDoc } from "@/hooks/use-collab-session";
import { DOCUMENT_FRAGMENT } from "@/lib/collab/room";
import { getUserColor } from "@/lib/user-colors";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";

interface GuestDocumentViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
  accessLevel: ShareAccessLevel;
}

export function GuestDocumentView({
  shareId,
  guestSub,
  guestName,
  accessLevel,
}: GuestDocumentViewProps) {
  const { resolvedTheme } = useTheme();
  const editable = accessLevel === "edit";

  const { yDoc, provider, awareness, isHydrated, isOffline } = useGuestDoc({
    shareId,
    guestSub,
    guestName,
    resourceType: "document",
  });

  const editor = useCreateBlockNote(
    withCollaboration({
      schema: documentSchema,
      collaboration: {
        provider: provider ?? { awareness },
        fragment: yDoc.getXmlFragment(DOCUMENT_FRAGMENT),
        user: {
          name: guestName,
          color: getUserColor(guestSub),
        },
      },
    }),
    [provider, awareness, guestName, guestSub],
  );

  // A guest's device keeps no offline cache (the link can be revoked), so the
  // only thing that can hydrate this document is a sync. Until one lands there
  // is nothing to show and — more to the point — nothing safe to write into.
  if (isOffline && !isHydrated) {
    return <NotAvailableOffline resource="doc" />;
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
          <BlockNoteView
            editor={editor}
            editable={editable && isHydrated}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
          />
        </div>
      </div>
    </div>
  );
}
