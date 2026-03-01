import {
  type LucideIcon,
  Building2,
  CheckSquare,
  FileText,
  Folder,
  ListTodo,
  MessageSquare,
  PenTool,
  Table2,
} from "lucide-react";

/**
 * Icons for resource categories (plural URL segments).
 * Used in breadcrumbs, sidebar, search results, etc.
 */
export const RESOURCE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  workspaces: Building2,
  projects: Folder,
  tasks: ListTodo,
  channels: MessageSquare,
  documents: FileText,
  diagrams: PenTool,
  spreadsheets: Table2,
  "my-tasks": CheckSquare,
};

/**
 * Icons for singular resource types (used in chips, references, etc.).
 */
export const RESOURCE_TYPE_ICONS: Record<string, LucideIcon> = {
  document: FileText,
  diagram: PenTool,
  spreadsheet: Table2,
  project: Folder,
  channel: MessageSquare,
  task: ListTodo,
};
