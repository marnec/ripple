import React from "react";
import { TaskMentionChip } from "@/pages/App/Chat/TaskMentionChip";
import { ProjectReferenceChip } from "@/pages/App/Chat/ProjectReferenceChip";
import { ResourceReferenceChip } from "@/pages/App/Chat/ResourceReferenceChip";
import { UserMentionRenderer } from "@/pages/App/Chat/UserMentionRenderer";
import { EventMentionChip } from "@/pages/App/Chat/EventMentionChip";
import { useDocumentBlockPreview } from "@/hooks/use-document-block-preview";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { FileText } from "lucide-react";
import { tableCellContent, tableCellSpans } from "@/lib/blocknote-table";
import { normalizeLinkUrl } from "@/lib/link-url";
import { SpreadsheetRangeSnapshot } from "@/pages/App/Chat/SpreadsheetRangeSnapshot";

// BlockNote JSON types (simplified for rendering)
export type Style = {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  textColor?: string;
  backgroundColor?: string;
};

type TextContent = {
  type: "text";
  text: string;
  styles: Style;
};

type LinkContent = {
  type: "link";
  href: string;
  content: TextContent[];
};

type TaskMentionContent = {
  type: "taskMention";
  props: { taskId: string; taskTitle?: string };
};

type ProjectReferenceContent = {
  type: "projectReference";
  props: { projectId: string };
};

type UserMentionContent = {
  type: "userMention";
  props: { userId: string };
};

type ResourceReferenceContent = {
  type: "resourceReference";
  props: {
    resourceId: string;
    resourceType: string;
    resourceName: string;
    /** A1 range, when the chip heads a frozen range table. */
    cellRef?: string;
  };
};

type EventMentionContent = {
  type: "eventMention";
  /** Exactly one of the two — an event row, or a **series**. */
  props: { eventId?: string; seriesId?: string };
};

export type InlineContent =
  | TextContent
  | LinkContent
  | TaskMentionContent
  | ProjectReferenceContent
  | UserMentionContent
  | ResourceReferenceContent
  | EventMentionContent;

export type Block = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[] | { type: "tableContent"; rows: TableRow[] };
  children?: Block[];
};

type TableRow = {
  /** Either shape of BlockNote's cell union — see `lib/blocknote-table`. */
  cells: unknown[];
};

/**
 * Shared read-only renderer for BlockNote JSON blocks.
 * Used by both chat messages (MessageRenderer) and task comments (StaticCommentBody).
 */
export function BlockNoteRenderer({ blocks }: { blocks: Block[] }) {
  return <>{renderBlockGroups(blocks)}</>;
}

/** Group consecutive list items and render all blocks */
// eslint-disable-next-line react-refresh/only-export-components
export function renderBlockGroups(blocks: Block[]): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    const snapshot = matchRangeSnapshot(blocks, i);
    if (snapshot) {
      if (snapshot.lead.length > 0) {
        result.push(
          <p key={`${block.id ?? i}-lead`} className="min-h-[1.5em]">
            {renderInlineArray(snapshot.lead)}
          </p>
        );
      }
      result.push(
        <SpreadsheetRangeSnapshot
          key={block.id ?? `range-${i}`}
          spreadsheetId={snapshot.chip.props.resourceId}
          spreadsheetName={snapshot.chip.props.resourceName}
          cellRef={snapshot.chip.props.cellRef!}
          rows={snapshot.rows}
        />
      );
      i += 2;
      continue;
    }

    if (block.type === "bulletListItem") {
      const items: Block[] = [];
      while (i < blocks.length && blocks[i].type === "bulletListItem") {
        items.push(blocks[i]);
        i++;
      }
      result.push(
        <ul key={`ul-${i}`} className="list-disc pl-6 my-1">
          {items.map((item, j) => (
            <li key={item.id ?? `li-${j}`}>
              {renderInlineContent(item.content)}
              {item.children && item.children.length > 0 && renderBlockGroups(item.children)}
            </li>
          ))}
        </ul>
      );
    } else if (block.type === "numberedListItem") {
      const items: Block[] = [];
      while (i < blocks.length && blocks[i].type === "numberedListItem") {
        items.push(blocks[i]);
        i++;
      }
      result.push(
        <ol key={`ol-${i}`} className="list-decimal pl-6 my-1">
          {items.map((item, j) => (
            <li key={item.id ?? `li-${j}`}>
              {renderInlineContent(item.content)}
              {item.children && item.children.length > 0 && renderBlockGroups(item.children)}
            </li>
          ))}
        </ol>
      );
    } else {
      result.push(<BlockRenderer key={block.id ?? i} block={block} />);
      i++;
    }
  }

  return result;
}

/**
 * A frozen spreadsheet range is stored as two plain blocks — a paragraph ending
 * in a spreadsheet reference chip that carries the A1, then an ordinary `table`
 * holding the cells (see `MessageComposer.insertSpreadsheetRange`). Recognising
 * that pair here, rather than minting a block type for it, is what lets every
 * range already sitting in a channel pick up the new rendering.
 *
 * Returns the inline content that ran *before* the chip, so the sender's own
 * words are not swallowed by the match.
 */
function matchRangeSnapshot(
  blocks: Block[],
  i: number
): { chip: ResourceReferenceContent; lead: InlineContent[]; rows: string[][] } | null {
  const head = trailingRangeChip(blocks[i]);
  if (!head) return null;
  const next = blocks[i + 1];
  if (!next || next.type !== "table") return null;
  const rows = tableRowsAsText(next.content);
  if (!rows) return null;
  return { ...head, rows };
}

/** The spreadsheet chip a paragraph ends on, plus whatever preceded it. */
function trailingRangeChip(
  block: Block | undefined
): { chip: ResourceReferenceContent; lead: InlineContent[] } | null {
  if (!block || block.type !== "paragraph" || !Array.isArray(block.content)) return null;
  const items = block.content;

  // The composer inserts the chip last, but a sender can leave whitespace after
  // it before hitting send.
  let last = items.length - 1;
  while (last >= 0) {
    const item = items[last];
    if (item.type === "text" && item.text.trim() === "") last--;
    else break;
  }

  const chip = items[last];
  if (!chip || chip.type !== "resourceReference") return null;
  if (chip.props.resourceType !== "spreadsheet" || !chip.props.cellRef) return null;
  return { chip, lead: items.slice(0, last) };
}

/** A stored table as plain text, or null when it holds no cells. */
function tableRowsAsText(content: Block["content"]): string[][] | null {
  if (!content || !("type" in content) || content.type !== "tableContent") return null;
  const rows = content.rows.map((row) => row.cells.map(cellAsText));
  if (rows.length === 0 || rows.every((row) => row.length === 0)) return null;
  return rows;
}

function cellAsText(cell: unknown): string {
  return tableCellContent<InlineContent>(cell)
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "link") return node.content.map((c) => c.text).join("");
      return "";
    })
    .join("");
}

function BlockRenderer({ block }: { block: Block }) {
  const children =
    block.children && block.children.length > 0 ? renderBlockGroups(block.children) : null;

  switch (block.type) {
    case "paragraph":
      return (
        <p className="min-h-[1.5em]">
          {renderInlineContent(block.content)}
          {children}
        </p>
      );

    case "heading":
      return (
        <p className="font-semibold">
          {renderInlineContent(block.content)}
          {children}
        </p>
      );

    case "checkListItem": {
      const checked = !!(block.props as { checked?: boolean })?.checked;
      return (
        <div className="flex items-start gap-2 my-0.5">
          <span className={`mt-0.5 ${checked ? "line-through text-muted-foreground" : ""}`}>
            {checked ? "\u2611" : "\u2610"}
          </span>
          <span className={checked ? "line-through text-muted-foreground" : ""}>
            {renderInlineContent(block.content)}
          </span>
          {children}
        </div>
      );
    }

    case "codeBlock":
      return (
        <pre className="bg-muted/50 rounded-md p-2 my-1 overflow-x-auto text-sm">
          <code>{renderInlineContent(block.content)}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="border-l-2 border-muted-foreground/40 pl-3 my-1 italic">
          {renderInlineContent(block.content)}
          {children}
        </blockquote>
      );

    case "divider":
      return <hr className="my-2 border-muted-foreground/20" />;

    case "image":
      return null;

    case "documentBlockEmbed":
      return <DocumentBlockEmbedRenderer props={block.props} />;

    case "table":
      return <TableRenderer content={block.content} />;

    default:
      return (
        <div className="my-0.5">
          {renderInlineContent(block.content)}
          {children}
        </div>
      );
  }
}

function TableRenderer({ content }: { content: Block["content"] }) {
  if (!content || !("type" in content) || content.type !== "tableContent") return null;
  const rows = content.rows;

  return (
    <table className="border-collapse my-1 text-sm">
      <tbody>
        {rows.map((row, ri) => (
          <tr key={`row-${ri}`}>
            {row.cells.map((cell, ci) => (
              <td
                key={`cell-${ri}-${ci}`}
                className="border border-muted-foreground/20 px-2 py-1"
                {...tableCellSpans(cell)}
              >
                {renderInlineArray(tableCellContent<InlineContent>(cell))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderInlineContent(content: Block["content"]): React.ReactNode {
  if (!content) return null;
  if (Array.isArray(content)) {
    return renderInlineArray(content);
  }
  return null;
}

function renderInlineArray(items: InlineContent[]): React.ReactNode {
  return items.map((item, i) => <InlineRenderer key={`inline-${i}`} content={item} />);
}

/**
 * Bodies are stored as JSON and rendered as anchors, so the href is re-checked
 * here and not only where the link was created: messages predate the composer's
 * validation, and a hand-crafted body never went through it at all. An href
 * that cannot be made absolute renders as plain text rather than as a link into
 * our own routes (or, for a `javascript:` payload, into our own origin).
 */
function LinkRenderer({ content }: { content: LinkContent }) {
  const text = content.content.map((c, i) => (
    <StyledText key={`link-text-${i}`} text={c.text} styles={c.styles} />
  ));
  const href = normalizeLinkUrl(content.href);
  if (!href) return <>{text}</>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {text}
    </a>
  );
}

function InlineRenderer({ content }: { content: InlineContent }) {
  switch (content.type) {
    case "text":
      return <StyledText text={content.text} styles={content.styles} />;

    case "link":
      return <LinkRenderer content={content} />;

    case "taskMention":
      return <TaskMentionChip taskId={content.props.taskId} />;

    case "projectReference":
      return <ProjectReferenceChip projectId={content.props.projectId} />;

    case "userMention":
      return <UserMentionRenderer userId={content.props.userId} />;

    case "resourceReference":
      return (
        <ResourceReferenceChip
          resourceId={content.props.resourceId}
          resourceType={content.props.resourceType}
          cellRef={content.props.cellRef}
        />
      );

    case "eventMention":
      return (
        <EventMentionChip
          eventId={content.props.eventId}
          seriesId={content.props.seriesId}
        />
      );

    default:
      return null;
  }
}

function DocumentBlockEmbedRenderer({ props }: { props?: Record<string, unknown> }) {
  const documentId = props?.documentId as string | undefined;
  const blockId = props?.blockId as string | undefined;

  const document = useQuery(
    api.documents.get,
    documentId ? { id: documentId as Id<"documents"> } : "skip",
  );
  const { textContent, blockType } = useDocumentBlockPreview(
    (documentId ?? ""),
    blockId ?? "",
  );

  if (!documentId || !blockId) return null;

  if (document === null) {
    return (
      <div className="text-sm text-muted-foreground italic my-1">
        Referenced document was deleted
      </div>
    );
  }

  if (!textContent) {
    return (
      <div className="text-sm text-muted-foreground italic my-1">
        Referenced block not found
      </div>
    );
  }

  return (
    <div className="border-l-3 border-primary/30 pl-3 py-1 my-1">
      <p className={`text-sm ${blockType === "heading" ? "font-semibold" : ""}`}>
        {textContent}
      </p>
      <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span className="truncate max-w-40">{document?.name ?? "Document"}</span>
      </div>
    </div>
  );
}

function StyledText({ text, styles }: { text: string; styles: Style }) {
  let node: React.ReactNode = text;

  if (styles.code) {
    node = <code className="bg-muted/50 rounded px-1 py-0.5 text-sm font-mono">{node}</code>;
  }
  if (styles.bold) node = <strong>{node}</strong>;
  if (styles.italic) node = <em>{node}</em>;
  if (styles.underline) node = <u>{node}</u>;
  if (styles.strike) node = <s>{node}</s>;

  return <>{node}</>;
}
