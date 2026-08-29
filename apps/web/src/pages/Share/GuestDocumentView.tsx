import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { withCollaboration } from "@blocknote/core/yjs";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "next-themes";
import { richTextDictionary } from "@/lib/blocknote/rich-text-schema";
import { getRichSlashMenuItems } from "@/lib/blocknote/slash-menu";
import { documentSchema } from "@/pages/App/Document/schema";
import {
  CollaborativeSurface,
  type HydratedSurface,
  type SurfaceMeta,
} from "@/components/CollaborativeSurface";
import type { CollaborativeDoc } from "@/hooks/use-collaborative-doc";
import { DOCUMENT_FRAGMENT } from "@/lib/collab/room";
import type { ShareAccessLevel } from "@ripple/shared/shareTypes";

interface GuestDocumentViewProps {
  /** The room, opened by `GuestResourceView` and shared with the header. */
  doc: CollaborativeDoc;
  accessLevel: ShareAccessLevel;
  guestName: string;
  guestColor: string;
}

/**
 * A shared document, opened for a guest.
 *
 * Through the same opening sequence a member gets, and for the same reason: a
 * guest's device keeps no offline cache and reads no cold-start snapshot, so a
 * completed sync is the *only* thing that can hydrate this replica. The window
 * between mount and that sync used to be the whole of a guest's session, and
 * the editor was mounted inside it.
 */
export function GuestDocumentView({
  doc,
  accessLevel,
  guestName,
  guestColor,
}: GuestDocumentViewProps) {
  return (
    <CollaborativeSurface<SurfaceMeta>
      resourceType="doc"
      doc={doc}
      meta={undefined}
    >
      {(surface) => (
        <GuestDocumentBody
          surface={surface}
          accessLevel={accessLevel}
          guestName={guestName}
          guestColor={guestColor}
        />
      )}
    </CollaborativeSurface>
  );
}

function GuestDocumentBody({
  surface,
  accessLevel,
  guestName,
  guestColor,
}: {
  surface: HydratedSurface<SurfaceMeta>;
  accessLevel: ShareAccessLevel;
  guestName: string;
  guestColor: string;
}) {
  const { resolvedTheme } = useTheme();
  const { yDoc, provider, awareness } = surface.doc;

  const editor = useCreateBlockNote(
    withCollaboration({
      schema: documentSchema,
      // Same dictionary as the member editor, so the math block's strings come
      // from the same place (see `richTextDictionary`).
      dictionary: richTextDictionary,
      collaboration: {
        // `awareness` is the provider's once connected, and a local one before
        // that — the same expression the member path uses.
        provider: provider ?? { awareness },
        fragment: yDoc.getXmlFragment(DOCUMENT_FRAGMENT),
        user: { name: guestName, color: guestColor },
      },
    }),
    [provider, awareness, guestName, guestColor],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
          <BlockNoteView
            editor={editor}
            // No `&& isHydrated` — the sequence above is what guarantees it.
            editable={accessLevel === "edit"}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            /* Replaced so the math items join the defaults, as for members. */
            slashMenu={false}
          >
            <SuggestionMenuController
              triggerCharacter={"/"}
              getItems={(query) => getRichSlashMenuItems(editor, query)}
            />
          </BlockNoteView>
        </div>
      </div>
    </div>
  );
}
