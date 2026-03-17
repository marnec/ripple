# PDF Upload, Viewer & Annotations

## Context
Ripple is a knowledge graph and project planner for small teams. Users want to upload PDFs, read them in-app, highlight text (Zotero-style), and embed annotations in documents. This adds a new first-class resource type alongside documents, diagrams, and spreadsheets.

## Library Choice
**`react-pdf-highlighter` v8.0.0-rc.0** — MIT, React 19 compatible, purpose-built for text selection → highlight annotations with saved overlay rendering. ~30KB + pdfjs-dist (~400KB, lazy-loaded). Fallback: `react-pdf` v10 + custom highlight layer if RC proves unstable.

---

## Phase 1: Schema & Backend

### 1.1 New tables in `convex/schema.ts`

**`pdfs` table** (mirrors diagrams pattern + storageId):
- `workspaceId`, `name`, `tags`, `storageId` (the PDF blob), `uploadedBy`, `fileName`, `fileSize`
- Indexes: `by_workspace`, searchIndex `by_name`

**`pdfAnnotations` table**:
- `pdfId`, `workspaceId` (denormalized), `userId`, `pageNumber`, `highlightAreas` (array of `{pageNumber, top, left, width, height}` — percentage-based rects), `selectedText`, `note` (optional), `color`
- Indexes: `by_pdf`, `by_pdf_page`, `by_workspace`

### 1.2 Extend existing unions in `convex/schema.ts`
- `favorites.resourceType` — add `v.literal("pdf")`
- `edges.sourceType` + `edges.targetType` — add `v.literal("pdf")`
- `recentActivity.resourceType` — add `v.literal("pdf")`

### 1.3 New file: `convex/pdfs.ts`
Follow `convex/diagrams.ts` pattern. Functions:
- `create` mutation — takes storageId + metadata, checks workspace membership, inserts, returns pdfId
- `list` query — by workspaceId, membership check
- `search` query — searchText + tags + isFavorite (same pattern as `diagrams.search`)
- `get` query — by id, membership check
- `getUrl` query — returns `ctx.storage.getUrl(storageId)`
- `rename` mutation
- `updateTags` mutation
- `remove` mutation — cascade delete: annotations, favorites, edges, recentActivity, storage blob

### 1.4 New file: `convex/pdfAnnotations.ts`
- `create` mutation — resolve workspaceId from pdf, check membership
- `list` query — by pdfId, check membership (Convex reactivity = real-time annotation sync)
- `get` query — by annotationId
- `update` mutation — update note/color
- `remove` mutation

### 1.5 Update existing Convex files
- **`convex/favorites.ts`** — Add `"pdf"` to `resourceTypeValidator`, `ResourceType`, `AnyResourceId`, `resolveResource`
- **`convex/favorites.ts` → `listAllIdsForWorkspace`** — Add `pdf: []` to return shape
- **`convex/edges.ts`** — Add `"pdf"` handling in edge enrichment if applicable
- **`convex/recentActivity.ts`** — Already generic, just needs the union update in schema
- **`shared/types/routes.ts`** — Add `pdfId: Id<"pdfs">`

---

## Phase 2: Upload Flow

### 2.1 Upload hook: `src/hooks/use-upload-pdf.ts`
Reuse `api.medias.generateUploadUrl` for the upload URL, then call `api.pdfs.create` (not `medias.saveMedia`) to create the pdf record. Flow: generateUploadUrl → POST file → pdfs.create(storageId, name, fileName, fileSize, workspaceId).

### 2.2 Upload dialog: `src/pages/App/PDF/UploadPDFDialog.tsx`
- File input `accept="application/pdf"` + drag-and-drop zone
- Max file size validation (Convex limit ~20MB, enforce ~15MB client-side)
- Progress indicator during upload
- On success: navigate to `/workspaces/:workspaceId/pdfs/:pdfId`

---

## Phase 3: PDF Viewer Page

### 3.1 Routes in `src/routes.tsx`
```
path: "pdfs"
  index → <PDFs />                    (eager, list page)
  :pdfId → lazy PDFViewer             (lazy)
  :pdfId/settings → lazy PDFSettings  (lazy)
```

### 3.2 List page: `src/pages/App/PDF/PDFs.tsx`
Use `ResourceListPage` wrapper with `resourceType="pdf"`. "Create" action opens UploadPDFDialog.
- Update `SearchResults.tsx`: add `"pdf"` to `ResourceType` union, add `api.pdfs.search` to `SEARCH_APIS`
- Update `ResourceListPage.tsx` if needed for the upload-instead-of-create pattern

### 3.3 Viewer page: `src/pages/App/PDF/PDFViewer.tsx`
Split layout: PDF canvas (~70%) + annotation sidebar (~30%).

**PDF canvas**: Uses `PdfHighlighter` from `react-pdf-highlighter`.
- Load PDF URL via `useQuery(api.pdfs.getUrl, { id: pdfId })`
- Render saved highlights from `useQuery(api.pdfAnnotations.list, { pdfId })`
- On text selection → tooltip with color picker + note input → `pdfAnnotations.create`
- Transform between our annotation data model and react-pdf-highlighter's highlight format

**Annotation sidebar**: `src/pages/App/PDF/AnnotationSidebar.tsx`
- Lists all annotations sorted by page
- Each item shows: page number, selected text excerpt, note, color indicator, author
- Click → scroll to highlight in viewer (via react-pdf-highlighter's `scrollToHighlight`)
- Delete/edit actions per annotation

### 3.4 Settings page: `src/pages/App/PDF/PDFSettings.tsx`
Follow `DiagramSettings.tsx` — name, tags, delete (with confirmation).

### 3.5 Header: Follow existing resource header pattern (name, favorite button, settings link).

---

## Phase 4: Sidebar Navigation

### 4.1 New components
- `src/pages/App/PDF/PDFSelectorList.tsx` — Follow `DiagramSelectorList.tsx`. Icon: `FileText` from lucide. Plus button opens upload dialog.
- `src/pages/App/PDF/PDFSelectorItem.tsx` — Follow `DiagramSelectorItem.tsx`. Context menu: rename, settings, unstar.
- `src/pages/App/PDF/RenamePDFDialog.tsx` — Follow existing rename dialog pattern.

### 4.2 Wire into `src/pages/App/AppSidebar.tsx`
- Add `PDFSelectorList` in the Documents/Diagrams/Spreadsheets group (after spreadsheets)
- Add `handlePDFSelect` handler + `pdfId` from useParams
- Add `"pdfs"` to sidebar section toggle state

---

## Phase 5: BlockNote Annotation Embed

### 5.1 New block: `src/pages/App/Document/CustomBlocks/PDFAnnotationBlock.tsx`
Follow `DocumentBlockEmbed.tsx` pattern. Props: `pdfId`, `annotationId`.

Renders: styled card with PDF name, quoted highlighted text, note, color accent, and click-to-navigate to PDF viewer scrolled to annotation.

### 5.2 Register in `src/pages/App/Document/schema.ts`
Add `pdfAnnotation: PDFAnnotationBlock()` to `blockSpecs`.

### 5.3 Insert mechanism — follow the `#` trigger pattern exactly like documents
In `src/pages/App/Document/useDocumentSuggestions.ts`:
- Add PDFs to the `#` hash-trigger suggestion list (alongside diagrams, spreadsheets, documents)
- When user selects a PDF, open an **AnnotationPickerDialog** (like `BlockPickerDialog` for documents)
- The dialog lists annotations for the selected PDF, grouped by page
- Selecting an annotation calls `editor.insertBlocks([{ type: "pdfAnnotation", props: { pdfId, annotationId } }], ...)`

New files:
- `src/pages/App/PDF/AnnotationPickerDialog.tsx` — modal listing PDF annotations for selection

Modified files:
- `src/pages/App/Document/useDocumentSuggestions.ts` — add PDF items to `getHashItems`, add `handleAnnotationPickerInsert` callback
- `src/pages/App/Document/DocumentEditor.tsx` — wire up `annotationPickerDialog` state + pass to `useDocumentSuggestions`

---

## Phase 6: Integration Polish

- **`src/lib/resource-icons.ts`** — Add PDF icon entries
- **`src/components/Breadcrumb.tsx`** — Add `pdfs` case to `DynamicBreadcrumb`
- **`src/components/CommandPalette.tsx`** — Include PDFs in search results
- **Recent activity** — Track PDF views (follow document/diagram pattern)
- **Notification preferences** — Add `pdfCreated`/`pdfDeleted` if desired (optional, can defer)
- **`convex/medias.ts`** — Extend `type` union to include `v.literal("pdf")` if using medias table, or skip if pdfs table handles storage directly

---

## Dependencies

```bash
npm install react-pdf-highlighter@8.0.0-rc.0 pdfjs-dist
```

Vite config: set `pdfjs.GlobalWorkerOptions.workerSrc` to CDN or copy worker to public/.

---

## Implementation Order

1. Phase 1 (Schema + Backend) — must be first
2. Phase 2 (Upload flow) — can test uploading immediately
3. Phase 4 (Sidebar) — quick, copy-paste from diagrams, enables navigation
4. Phase 3 (Viewer) — core feature, depends on 1+2
5. Phase 5 (BlockNote embed) — depends on viewer working
6. Phase 6 (Polish) — can be done incrementally

---

## Key Files to Modify/Create

| Action | File |
|--------|------|
| Modify | `convex/schema.ts` |
| Modify | `convex/favorites.ts` |
| Modify | `shared/types/routes.ts` |
| Modify | `src/routes.tsx` |
| Modify | `src/pages/App/AppSidebar.tsx` |
| Modify | `src/pages/App/Resources/SearchResults.tsx` |
| Modify | `src/pages/App/Document/schema.ts` |
| Modify | `src/pages/App/Document/useDocumentSuggestions.ts` |
| Modify | `src/pages/App/Document/DocumentEditor.tsx` |
| Create | `convex/pdfs.ts` |
| Create | `convex/pdfAnnotations.ts` |
| Create | `src/hooks/use-upload-pdf.ts` |
| Create | `src/pages/App/PDF/PDFs.tsx` |
| Create | `src/pages/App/PDF/PDFViewer.tsx` |
| Create | `src/pages/App/PDF/PDFSettings.tsx` |
| Create | `src/pages/App/PDF/AnnotationSidebar.tsx` |
| Create | `src/pages/App/PDF/UploadPDFDialog.tsx` |
| Create | `src/pages/App/PDF/PDFSelectorList.tsx` |
| Create | `src/pages/App/PDF/PDFSelectorItem.tsx` |
| Create | `src/pages/App/PDF/RenamePDFDialog.tsx` |
| Create | `src/pages/App/PDF/AnnotationPickerDialog.tsx` |
| Create | `src/pages/App/Document/CustomBlocks/PDFAnnotationBlock.tsx` |

## Verification

1. `npm run lint` — no TypeScript or ESLint errors
2. `npm test` — existing tests pass
3. Manual: upload a PDF → view it → select text → create highlight → verify annotation appears in sidebar → open a document → insert PDF annotation block → verify it renders the quote → click to navigate back to PDF
4. Real-time: open same PDF in two browser tabs → create annotation in one → verify it appears in the other
