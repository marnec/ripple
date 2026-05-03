
import { BacklinksDrawer } from "@/components/BacklinksDrawer";
import { FavoriteButton } from "@/components/FavoriteButton";
import {
  TagInlineStrip,
  TagPickerButton,
} from "@/components/TagPickerButton";
import { Button } from "@/components/ui/button";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useCursorAwareness } from "@/hooks/use-cursor-awareness";
import { useFormulaPicker } from "@/hooks/use-formula-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import { useJSpreadsheetInstance } from "@/hooks/use-jspreadsheet-instance";
import { useSpreadsheetCollaboration } from "@/hooks/use-spreadsheet-collaboration";
import { useSpreadsheetContextMenu } from "@/hooks/use-spreadsheet-context-menu";
import { useRecordVisit } from "@/hooks/use-record-visit";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import { getUserColor } from "@/lib/user-colors";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useViewer } from "../UserContext";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import { Circle, Link2, Link2Off, Settings, Share2, WifiOff } from "lucide-react";
import { ShareDialog } from "@/components/ShareDialog";
import { memo, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ActiveUsers } from "../Document/ActiveUsers";
import {
  FormulaPickerDropdown,
} from "./FormulaPickerDropdown";
import { FormulaBar } from "./FormulaBar";
import { SpreadsheetContextMenu } from "./SpreadsheetContextMenu";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";

// ---------------------------------------------------------------------------
// Connection Status Badge
// ---------------------------------------------------------------------------

function ConnectionStatus({
  isConnected,
  isOffline,
}: {
  isConnected: boolean;
  isOffline: boolean;
}) {
  if (isOffline) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <WifiOff className="h-3 w-3" />
        Offline
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Circle
        className={`h-2 w-2 fill-current ${isConnected ? "text-green-500" : "text-yellow-500"}`}
      />
      {isConnected ? "Connected" : "Connecting..."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid Component
// ---------------------------------------------------------------------------

const JSpreadsheetGrid = memo(function JSpreadsheetGrid({
  yDoc,
  awareness,
  remoteUserClientIds,
  referencedCellRefs,
  importedRows,
  onSelectionChange,
  onEditingChange,
  onBindingReady,
}: {
  yDoc: Y.Doc;
  awareness: Awareness | null;
  remoteUserClientIds: Set<number>;
  referencedCellRefs: { cellRef: string }[];
  importedRows: unknown[][] | null;
  onSelectionChange: (sel: { row: number; col: number } | null) => void;
  onEditingChange: (editing: boolean) => void;
  onBindingReady: (binding: SpreadsheetYjsBinding | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const importSeededRef = useRef(false);

  // Formula picker
  const {
    formulaPicker,
    formulaPickerHandleRef,
    insertFormula,
    onEditionStart: pickerOnEditionStart,
    onEditionEnd: pickerOnEditionEnd,
    registerKeyboardInterception,
  } = useFormulaPicker();

  // Compose formula-picker handlers with isEditing tracking for FormulaBar.
  const onEditionStart = (td: HTMLTableCellElement, wrapper: HTMLElement) => {
    onEditingChange(true);
    pickerOnEditionStart(td, wrapper);
  };
  const onEditionEnd = () => {
    onEditingChange(false);
    pickerOnEditionEnd();
  };

  // jspreadsheet + Yjs binding
  const { worksheetRef, bindingRef } = useJSpreadsheetInstance({
    wrapperRef,
    yDoc,
    awareness,
    onEditionStart,
    onEditionEnd,
    onSelectionChange: (sel) => {
      onSelectionChange(sel ? { row: sel.y1, col: sel.x1 } : null);
    },
  });

  // Hand the binding instance up to the page so the FormulaBar can read/write.
  // Deps mirror the binding-creation effect inside useJSpreadsheetInstance so
  // we re-emit when the underlying binding is recreated.
  useEffect(() => {
    onBindingReady(bindingRef.current);
    return () => onBindingReady(null);
  }, [bindingRef, onBindingReady, yDoc, awareness]);

  // Seed once from imported rows (e.g. .xlsx upload). Runs after the binding
  // effect above has set bindingRef.current — effects run in declaration order.
  useEffect(() => {
    if (importSeededRef.current || !importedRows || !bindingRef.current) return;
    importSeededRef.current = true;
    bindingRef.current.seedFromImport(importedRows);
    window.history.replaceState({}, "");
  }, [importedRows, bindingRef]);

  // Context menu
  const { menu, menuRef, registerContextMenu, actions } =
    useSpreadsheetContextMenu(worksheetRef);

  // Register context menu listener on the wrapper
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    return registerContextMenu(wrapper);
  }, [registerContextMenu]);

  // Register formula picker keyboard interception
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    return registerKeyboardInterception(wrapper);
  }, [registerKeyboardInterception]);

  // Sync active client IDs to binding (remove stale cursors)
  useEffect(() => {
    bindingRef.current?.setActiveClients(remoteUserClientIds);
  }, [remoteUserClientIds, bindingRef]);

  // Sync referenced cell refs to binding (highlight referenced cells)
  useEffect(() => {
    bindingRef.current?.setReferencedCells(referencedCellRefs);
  }, [referencedCellRefs, yDoc, awareness, bindingRef]);

  return (
    <>
      <div ref={wrapperRef} className="h-full" />
      {menu && (
        <SpreadsheetContextMenu
          menu={menu}
          menuRef={menuRef}
          actions={actions}
        />
      )}
      <FormulaPickerDropdown
        ref={formulaPickerHandleRef}
        position={formulaPicker?.position ?? { x: 0, y: 0 }}
        query={formulaPicker?.query ?? ""}
        onSelect={insertFormula}
        onDismiss={() => {}}
        visible={!!formulaPicker?.visible}
      />
    </>
  );
});

// ---------------------------------------------------------------------------
// Page Components
// ---------------------------------------------------------------------------

function SpreadsheetEditor({
  spreadsheetId,
}: {
  spreadsheetId: Id<"spreadsheets">;
}) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const importedRows =
    (location.state as { importedRows?: unknown[][] } | null)?.importedRows ??
    null;
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  useRecordVisit(spreadsheet?.workspaceId, "spreadsheet", spreadsheetId, spreadsheet?.name);
  const viewer = useViewer();
  const rawRefs = useQuery(api.spreadsheetCellRefs.listBySpreadsheet, { spreadsheetId });
  const [showRefHighlights, setShowRefHighlights] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [selection, setSelection] = useState<{ row: number; col: number } | null>(null);
  const [isCellEditing, setIsCellEditing] = useState(false);
  const [binding, setBinding] = useState<SpreadsheetYjsBinding | null>(null);
  const myRole = useQuery(
    api.workspaceMembers.myRole,
    spreadsheet ? { workspaceId: spreadsheet.workspaceId } : "skip",
  );
  const isAdmin = myRole === "admin";
  const updateTags = useMutation(api.spreadsheets.updateTags).withOptimisticUpdate(
    tagsOptimisticUpdate(api.spreadsheets.get),
  );

  // Stabilize ref identity to prevent unnecessary JSpreadsheetGrid re-renders
  const referencedCellRefs = showRefHighlights ? rawRefs ?? [] : [];

  const hasRefs = (rawRefs?.length ?? 0) > 0;

  const {
    yDoc,
    awareness,
    isConnected,
    isOffline,
    isLoading: collabLoading,
  } = useSpreadsheetCollaboration({
    spreadsheetId: spreadsheetId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "unknown",
  });

  const { remoteUsers } = useCursorAwareness(awareness);

  const remoteUserClientIds = new Set(remoteUsers.map((u) => u.clientId));

  if (spreadsheet === undefined || viewer === undefined) {
    return <div className="h-full w-full" />;
  }

  if (spreadsheet === null) {
    return <ResourceDeleted resourceType="spreadsheet" />;
  }

  if (collabLoading) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="flex h-full w-full flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex h-8 min-w-0 items-center gap-4">
          <FavoriteButton
            resourceType="spreadsheet"
            resourceId={spreadsheetId}
            workspaceId={spreadsheet.workspaceId}
          />
          <TagPickerButton
            workspaceId={spreadsheet.workspaceId}
            value={spreadsheet.tags ?? []}
            onChange={(tags) => void updateTags({ id: spreadsheetId, tags })}
          />
          <h1 className="hidden sm:block text-lg font-semibold truncate">{spreadsheet.name}</h1>
          <TagInlineStrip tags={spreadsheet.tags ?? []} />
          {hasRefs && (
            <button
              type="button"
              onClick={() => {
                setShowRefHighlights((v) => {
                  if (!v) setBacklinksOpen(true);
                  return !v;
                });
              }}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors ml-2"
              title={showRefHighlights ? "Hide reference highlights" : "Show reference highlights"}
            >
              {showRefHighlights ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
              References
            </button>
          )}
        </div>
        <FormulaBar binding={binding} selection={selection} isEditing={isCellEditing} />
        <div className="flex h-8 items-center gap-3">
          <ConnectionStatus isConnected={isConnected} isOffline={isOffline} />
          {isConnected && (
            <ActiveUsers
              remoteUsers={remoteUsers}
              currentUser={
                viewer
                  ? { name: viewer.name, color: getUserColor(viewer._id) }
                  : undefined
              }
            />
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShareDialogOpen(true)}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Share"
            >
              <Share2 className="size-4" />
            </button>
          )}
          {!isMobile && (
            <Link
              to="settings"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Spreadsheet settings"
            >
              <Settings className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {isAdmin && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          resourceType="spreadsheet"
          resourceId={spreadsheetId}
          resourceName={spreadsheet.name}
        />
      )}
      {isMobile && (
        <HeaderSlot>
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="settings" />}
            aria-label="Spreadsheet settings"
          >
            <Settings className="size-4" />
          </Button>
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={spreadsheet.name} />
      <BacklinksDrawer
        resourceId={spreadsheetId}
        workspaceId={spreadsheet.workspaceId}
        open={backlinksOpen}
        onOpenChange={setBacklinksOpen}
      />

      <div className="flex-1 overflow-hidden">
        <JSpreadsheetGrid
          yDoc={yDoc}
          awareness={awareness}
          remoteUserClientIds={remoteUserClientIds}
          referencedCellRefs={referencedCellRefs}
          importedRows={importedRows}
          onSelectionChange={setSelection}
          onEditingChange={setIsCellEditing}
          onBindingReady={setBinding}
        />
      </div>
    </div>
  );
}

export function SpreadsheetPage() {
  const { spreadsheetId } = useParams<QueryParams>();

  if (!spreadsheetId) return <SomethingWentWrong />;

  return <SpreadsheetEditor key={spreadsheetId} spreadsheetId={spreadsheetId} />;
}
