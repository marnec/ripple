
import {
  CollaborativeSurface,
  type HydratedSurface,
} from "@/components/CollaborativeSurface";
import { SurfaceHeader } from "@/components/SurfaceHeader";
import { useResourceDoc } from "@/hooks/use-collab-session";
import { SurfaceActiveUsers } from "@/components/SurfaceActiveUsers";
import { useCursorAwareness } from "@/hooks/use-cursor-awareness";
import { useCursorIdentity } from "@/hooks/use-cursor-identity";
import { useFormulaPicker } from "@/hooks/use-formula-picker";
import { useJSpreadsheetInstance } from "@/hooks/use-jspreadsheet-instance";
import { useSpreadsheetContextMenu } from "@/hooks/use-spreadsheet-context-menu";
import { tagsOptimisticUpdate } from "@/lib/tag-optimistic";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useViewer } from "../UserContext";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import { useSelectionFormulaHighlights } from "@/hooks/use-selection-formula-highlights";
import { SpreadsheetActionsMenu } from "./SpreadsheetActionsMenu";
import { memo, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  FormulaPickerDropdown,
} from "./FormulaPickerDropdown";
import { FormulaBar } from "./FormulaBar";
import { ConfirmRefShiftDialog } from "./ConfirmRefShiftDialog";
import { SpreadsheetContextMenu } from "./SpreadsheetContextMenu";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";

// ---------------------------------------------------------------------------
// Grid Component
// ---------------------------------------------------------------------------

const JSpreadsheetGrid = memo(function JSpreadsheetGrid({
  yDoc,
  isHydrated,
  awareness,
  remoteUserClientIds,
  referencedCellRefs,
  externalRefs,
  importedRows,
  preventBlurOnClick,
  onSelectionChange,
  onEditingChange,
  onBindingReady,
}: {
  yDoc: Y.Doc;
  isHydrated: boolean;
  awareness: Awareness | null;
  remoteUserClientIds: Set<number>;
  referencedCellRefs: { cellRef: string }[];
  externalRefs: ReadonlyArray<{ cellRef: string; orphan?: boolean }>;
  importedRows: unknown[][] | null;
  /** While true, swallow mousedown.preventDefault on the grid so clicking a
   *  cell doesn't shift focus away from the FormulaBar (click-to-pick). */
  preventBlurOnClick: boolean;
  onSelectionChange: (sel: { row: number; col: number } | null) => void;
  onEditingChange: (editing: boolean) => void;
  onBindingReady: (binding: SpreadsheetYjsBinding | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const importSeededRef = useRef(false);
  // Mirror ref for the binding so the formula picker (declared before
  // useJSpreadsheetInstance creates the real ref) can drive live cell-ref
  // highlights from the in-cell editor.
  const bindingMirrorRef = useRef<SpreadsheetYjsBinding | null>(null);

  // Formula picker
  const {
    formulaPicker,
    formulaPickerHandleRef,
    insertFormula,
    onEditionStart: pickerOnEditionStart,
    onEditionEnd: pickerOnEditionEnd,
    registerKeyboardInterception,
  } = useFormulaPicker(bindingMirrorRef);

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
    isHydrated,
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
    bindingMirrorRef.current = bindingRef.current;
    return () => {
      onBindingReady(null);
      bindingMirrorRef.current = null;
    };
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
  const { menu, menuRef, registerContextMenu, actions, pending, cancelPending } =
    useSpreadsheetContextMenu(worksheetRef, externalRefs);

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

  // While the FormulaBar is in click-to-pick mode, prevent the grid's
  // mousedown from stealing focus. The selection still updates (jspreadsheet
  // handlers run regardless), so the FormulaBar's selection-change effect
  // sees the click and inserts the picked cell ref.
  useEffect(() => {
    if (!preventBlurOnClick) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
    };
    wrapper.addEventListener("mousedown", onMouseDown);
    return () => wrapper.removeEventListener("mousedown", onMouseDown);
  }, [preventBlurOnClick]);

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
      {pending && (
        <ConfirmRefShiftDialog
          op={pending.op}
          affected={pending.affected}
          onConfirm={pending.apply}
          onCancel={cancelPending}
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

/** What the header renders for a spreadsheet. */
interface SpreadsheetMeta {
  name: string;
  tags?: string[];
}

function SpreadsheetEditor({
  spreadsheetId,
  workspaceId,
}: {
  spreadsheetId: Id<"spreadsheets">;
  workspaceId: Id<"workspaces">;
}) {
  const location = useLocation();
  const importedRows =
    (location.state as { importedRows?: unknown[][] } | null)?.importedRows ?? null;
  const liveSpreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const viewer = useViewer();
  const rawRefs = useQuery(api.spreadsheetCellRefs.listBySpreadsheet, { spreadsheetId });
  // Cell highlights mirror the references drawer: on while it's open.
  const [showRefHighlights, setShowRefHighlights] = useState(false);
  const [selection, setSelection] = useState<{ row: number; col: number } | null>(null);
  const [isCellEditing, setIsCellEditing] = useState(false);
  const [binding, setBinding] = useState<SpreadsheetYjsBinding | null>(null);
  const [formulaBarPicking, setFormulaBarPicking] = useState(false);
  const [formulaBarFocused, setFormulaBarFocused] = useState(false);
  const myRole = useQuery(api.workspaceMembers.myRole, { workspaceId });
  const isAdmin = myRole === "admin";
  // The room, opened here and handed to the sequence.
  const doc = useResourceDoc({
    resourceType: "spreadsheet",
    resourceId: spreadsheetId,
  });
  const updateTags = useMutation(api.spreadsheets.updateTags).withOptimisticUpdate(
    tagsOptimisticUpdate(api.spreadsheets.get),
  );

  // Stabilize ref identity to prevent unnecessary JSpreadsheetGrid re-renders
  const referencedCellRefs = showRefHighlights ? rawRefs ?? [] : [];

  useSelectionFormulaHighlights({
    binding,
    selection,
    suppressed: formulaBarFocused || isCellEditing,
  });

  return (
    <CollaborativeSurface<SpreadsheetMeta>
      resourceType="spreadsheet"
      doc={doc}
      meta={liveSpreadsheet}
    >
      {(surface) => (
        <>
          <SurfaceHeader
            surface={surface}
            resourceType="spreadsheet"
            resourceId={spreadsheetId}
            workspaceId={workspaceId}
            onTagsChange={(tags) => void updateTags({ id: spreadsheetId, tags })}
            settingsTitle="Spreadsheet settings"
            focusable
            onBacklinksOpenChange={setShowRefHighlights}
            activeUsers={(awareness) => (
              <SurfaceActiveUsers awareness={awareness} viewer={viewer} />
            )}
            centre={
              <FormulaBar
                binding={binding}
                selection={selection}
                isEditing={isCellEditing}
                onPickingChange={setFormulaBarPicking}
                onFocusChange={setFormulaBarFocused}
              />
            }
            actions={(meta) => (
              <SpreadsheetActionsMenu
                spreadsheetId={spreadsheetId}
                spreadsheetName={meta.name}
                isAdmin={isAdmin}
                binding={binding}
              />
            )}
          />
          <SpreadsheetGridPane
            surface={surface}
            viewer={viewer}
            referencedCellRefs={referencedCellRefs}
            externalRefs={rawRefs ?? []}
            importedRows={importedRows}
            preventBlurOnClick={formulaBarPicking}
            onSelectionChange={setSelection}
            onEditingChange={setIsCellEditing}
            onBindingReady={setBinding}
          />
        </>
      )}
    </CollaborativeSurface>
  );
}

/**
 * The grid, bound to a replica that is known to hold the spreadsheet.
 *
 * Derives presence of its own rather than taking it from the header: the grid
 * needs the active client ids to drop stale cursors, and one awareness listener
 * per need keeps that where it is used.
 */
function SpreadsheetGridPane({
  surface,
  viewer,
  referencedCellRefs,
  externalRefs,
  importedRows,
  preventBlurOnClick,
  onSelectionChange,
  onEditingChange,
  onBindingReady,
}: {
  surface: HydratedSurface<SpreadsheetMeta>;
  viewer: { _id: Id<"users">; name?: string } | null | undefined;
  referencedCellRefs: { cellRef: string }[];
  externalRefs: ReadonlyArray<{ cellRef: string; orphan?: boolean }>;
  importedRows: unknown[][] | null;
  preventBlurOnClick: boolean;
  onSelectionChange: (sel: { row: number; col: number } | null) => void;
  onEditingChange: (editing: boolean) => void;
  onBindingReady: (binding: SpreadsheetYjsBinding | null) => void;
}) {
  const { yDoc, awareness, isHydrated } = surface.doc;
  useCursorIdentity(awareness, viewer?.name ?? "Anonymous", viewer?._id ?? "unknown");

  const { remoteUsers } = useCursorAwareness(awareness);
  const remoteUserClientIds = new Set(remoteUsers.map((u) => u.clientId));

  return (
    <div className="flex-1 overflow-hidden">
      <JSpreadsheetGrid
        yDoc={yDoc}
        isHydrated={isHydrated}
        awareness={awareness}
        remoteUserClientIds={remoteUserClientIds}
        referencedCellRefs={referencedCellRefs}
        externalRefs={externalRefs}
        importedRows={importedRows}
        preventBlurOnClick={preventBlurOnClick}
        onSelectionChange={onSelectionChange}
        onEditingChange={onEditingChange}
        onBindingReady={onBindingReady}
      />
    </div>
  );
}

export function SpreadsheetPage() {
  const { spreadsheetId, workspaceId } = useParams<QueryParams>();

  if (!spreadsheetId || !workspaceId) return <SomethingWentWrong />;

  return (
    <SpreadsheetEditor
      key={spreadsheetId}
      spreadsheetId={spreadsheetId}
      workspaceId={workspaceId}
    />
  );
}
