import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import { Awareness } from "y-protocols/awareness";
import { documentSchema } from "@/pages/App/Document/schema";
import { useGuestYjsProvider } from "@/hooks/use-guest-yjs-provider";
import { getUserColor } from "@/lib/user-colors";
import type { ShareAccessLevel } from "@shared/shareTypes";
import { useMemo } from "react";

interface GuestDocumentViewProps {
  shareId: string;
  guestSub: string;
  guestName: string;
  resourceId: string;
  accessLevel: ShareAccessLevel;
}

export function GuestDocumentView({
  shareId,
  guestSub,
  guestName,
  resourceId,
  accessLevel,
}: GuestDocumentViewProps) {
  const { resolvedTheme } = useTheme();
  const editable = accessLevel === "edit";

  const { yDoc, provider } = useGuestYjsProvider({
    shareId,
    guestSub,
    guestName,
    resourceType: "document",
    resourceId,
  });

  // Local awareness so the editor can bind before the provider connects
  const localAwareness = useMemo(() => new Awareness(yDoc), [yDoc]);

  const editor = useCreateBlockNote(
    {
      schema: documentSchema,
      collaboration: {
        provider: provider ?? { awareness: localAwareness },
        fragment: yDoc.getXmlFragment("document-store"),
        user: {
          name: guestName,
          color: getUserColor(guestSub),
        },
      },
    },
    [provider, localAwareness, guestName, guestSub],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
          <BlockNoteView
            editor={editor}
            editable={editable}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
          />
        </div>
      </div>
    </div>
  );
}
