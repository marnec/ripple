import React from "react";
import { TaskMentionChip } from "./TaskMentionChip";
import { ProjectReferenceChip } from "./ProjectReferenceChip";
import { ResourceReferenceChip } from "./ResourceReferenceChip";
import { UserMentionRenderer } from "./UserMentionRenderer";

// BlockNote JSON types (simplified for rendering)
type Style = {
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
  props: { resourceId: string; resourceType: string; resourceName: string };
};

type InlineContent = TextContent | LinkContent | TaskMentionContent | ProjectReferenceContent | UserMentionContent | ResourceReferenceContent;

type Block = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[] | { type: "tableContent"; rows: TableRow[] };
  children?: Block[];
};

type TableRow = {
  cells: TableCell[];
};

type TableCell = InlineContent[][];

interface MessageRendererProps {
  blocks: Block[];
}

export function MessageRenderer({ blocks }: MessageRendererProps) {
  return <>{renderBlockGroups(blocks)}</>;
}

/** Group consecutive list items and render all blocks */
function renderBlockGroups(blocks: Block[]): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === "bulletListItem") {
      const items: Block[] = [];
      while (i < blocks.length && blocks[i].type === "bulletListItem") {
        items.push(blocks[i]);
        i++;
      }
      result.push(
        <ul key={`ul-${i}`} className="list-disc pl-6 my-1">
          {items.map((item, j) => (
            <li key={j}>
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
            <li key={j}>
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

function BlockRenderer({ block }: { block: Block }) {
  const children = block.children && block.children.length > 0
    ? renderBlockGroups(block.children)
    : null;

  switch (block.type) {
    case "paragraph":
      return (
        <p className="min-h-[1.5em]">
          {renderInlineContent(block.content)}
          {children}
        </p>
      );

    case "checkListItem": {
      const checked = !!(block.props as { checked?: boolean })?.checked;
      return (
        <div className="flex items-start gap-2 my-0.5">
          <span className={`mt-0.5 ${checked ? "line-through text-muted-foreground" : ""}`}>
            {checked ? "☑" : "☐"}
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

    case "image": {
      const url = (block.props as { url?: string })?.url;
      const caption = (block.props as { caption?: string })?.caption;
      if (!url) return null;
      return (
        <figure className="my-2">
          <img src={url} alt={caption || ""} className="max-w-full rounded-md max-h-96" loading="lazy" />
          {caption && <figcaption className="text-xs text-muted-foreground mt-1">{caption}</figcaption>}
        </figure>
      );
    }

    case "table":
      return <TableRenderer content={block.content} />;

    default:
      // Fallback for file, video, toggleListItem, etc.
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
          <tr key={ri}>
            {row.cells.map((cell, ci) => (
              <td key={ci} className="border border-muted-foreground/20 px-2 py-1">
                {cell.map((cellContent, pi) => (
                  <React.Fragment key={pi}>
                    {renderInlineArray(cellContent)}
                  </React.Fragment>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderInlineContent(
  content: Block["content"]
): React.ReactNode {
  if (!content) return null;
  if (Array.isArray(content)) {
    return renderInlineArray(content);
  }
  // tableContent handled by TableRenderer
  return null;
}

function renderInlineArray(items: InlineContent[]): React.ReactNode {
  return items.map((item, i) => <InlineRenderer key={i} content={item} />);
}

function InlineRenderer({ content }: { content: InlineContent }) {
  switch (content.type) {
    case "text":
      return <StyledText text={content.text} styles={content.styles} />;

    case "link":
      return (
        <a
          href={content.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {content.content.map((c, i) => (
            <StyledText key={i} text={c.text} styles={c.styles} />
          ))}
        </a>
      );

    case "taskMention":
      return <TaskMentionChip taskId={content.props.taskId} />;

    case "projectReference":
      return <ProjectReferenceChip projectId={content.props.projectId} />;

    case "userMention":
      return <UserMentionRenderer userId={content.props.userId} />;

    case "resourceReference":
      return <ResourceReferenceChip resourceId={content.props.resourceId} resourceType={content.props.resourceType} />;

    default:
      return null;
  }
}

function StyledText({ text, styles }: { text: string; styles: Style }) {
  let node: React.ReactNode = text;

  if (styles.code) {
    node = (
      <code className="bg-muted/50 rounded px-1 py-0.5 text-sm font-mono">{node}</code>
    );
  }
  if (styles.bold) node = <strong>{node}</strong>;
  if (styles.italic) node = <em>{node}</em>;
  if (styles.underline) node = <u>{node}</u>;
  if (styles.strike) node = <s>{node}</s>;

  return <>{node}</>;
}
