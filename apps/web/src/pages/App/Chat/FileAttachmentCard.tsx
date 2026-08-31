import {
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
} from "lucide-react";
import { formatFileSize } from "@shared/constants";
import { cn } from "@/lib/utils";

export interface FileAttachment {
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
}

/**
 * MIME first, extension second. The MIME type is what the browser reported at
 * pick time and is right for the common cases; the extension is the fallback
 * for the ones it types as `application/octet-stream` (which is most archives,
 * and anything dragged out of a zip).
 */
function AttachmentIcon({
  mimeType,
  name,
  className,
}: {
  mimeType?: string;
  name: string;
  className?: string;
}) {
  const mime = mimeType ?? "";
  if (mime.startsWith("image/")) return <ImageIcon className={className} />;
  if (mime.startsWith("audio/")) return <FileAudio className={className} />;
  if (mime.startsWith("video/")) return <FileVideo className={className} />;
  if (mime === "application/pdf") return <FileText className={className} />;

  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (["zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz"].includes(ext))
    return <FileArchive className={className} />;
  if (["csv", "tsv", "xls", "xlsx", "ods"].includes(ext))
    return <FileSpreadsheet className={className} />;
  if (["json", "ts", "tsx", "js", "jsx", "py", "rs", "go", "sh", "sql", "yml", "yaml"].includes(ext))
    return <FileCode className={className} />;
  if (mime.startsWith("text/") || ["md", "txt", "doc", "docx", "odt"].includes(ext))
    return <FileText className={className} />;
  return <FileIcon className={className} />;
}

/** The extension, uppercased, for the secondary line — "PDF · 2.3 MB". */
function extensionLabel(name: string): string {
  if (!name.includes(".")) return "File";
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return ext.length > 0 && ext.length <= 5 ? ext.toUpperCase() : "File";
}

/**
 * A file attached to a chat message. Deliberately a link and not a
 * fetch-then-save: the Convex storage URL is already a capability to the
 * bytes, and letting the browser handle it keeps PDFs and images previewable
 * in a tab instead of forcing every type down the downloads bar.
 */
export function FileAttachmentCard({
  attachment,
  className,
}: {
  attachment: FileAttachment;
  className?: string;
}) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      title={attachment.name}
      className={cn(
        "group/file flex max-w-xs items-center gap-2.5 rounded-md border bg-background/60 px-2.5 py-2 text-left transition-colors hover:bg-background",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
        <AttachmentIcon
          mimeType={attachment.mimeType}
          name={attachment.name}
          className="h-4.5 w-4.5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">
          {extensionLabel(attachment.name)}
          {attachment.size ? ` · ${formatFileSize(attachment.size)}` : ""}
        </span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100" />
    </a>
  );
}
