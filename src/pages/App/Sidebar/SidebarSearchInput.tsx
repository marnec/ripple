import { parseSearchInput } from "@/lib/search-utils";
import { Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarInput } from "../../../components/ui/sidebar";

type SidebarSearchInputProps = {
  workspaceId: Id<"workspaces">;
  resourceRoute: string; // e.g. "documents", "diagrams"
  onClose: () => void;
};

export function SidebarSearchInput({
  workspaceId,
  resourceRoute,
  onClose,
}: SidebarSearchInputProps) {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { searchText, tags } = parseSearchInput(value);
    const params = new URLSearchParams();
    params.set("tab", "search");
    if (searchText) params.set("q", searchText);
    if (tags.length > 0) params.set("tags", tags.join(","));
    void navigate(`/workspaces/${workspaceId}/${resourceRoute}?${params.toString()}`);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-2 pb-1">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <SidebarInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search... #tag"
          autoFocus
          className="pl-7 h-7 text-xs"
        />
      </div>
    </form>
  );
}
