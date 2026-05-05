import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type {
  ShareAccessLevel,
  ShareResourceType,
} from "@ripple/shared/shareTypes";

/** Mirror of `SHARE_NAME_MAX` in convex/shares.ts. Keep in sync. */
const SHARE_NAME_MAX = 60;

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: ShareResourceType;
  resourceId: string;
  resourceName: string;
}

/**
 * Admin-only dialog for managing guest share links on a single resource.
 * Shows existing links with a revoke button and a form to create new ones.
 *
 * Visibility of the triggering button is the caller's responsibility — the
 * Convex mutations also enforce admin-only, so clients that somehow open the
 * dialog anyway will fail on submit.
 */
export function ShareDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
  resourceName,
}: ShareDialogProps) {
  const isChannel = resourceType === "channel";
  const defaultLevel: ShareAccessLevel = isChannel ? "join" : "view";

  const shares = useQuery(
    api.shares.listSharesForResource,
    open ? { resourceType, resourceId } : "skip",
  );
  const createShare = useMutation(api.shares.createShare);
  const revokeShare = useMutation(api.shares.revokeShare);
  const renameShare = useMutation(api.shares.renameShare);

  const [accessLevel, setAccessLevel] = useState<ShareAccessLevel>(defaultLevel);
  const [expiryDate, setExpiryDate] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeShares = useMemo(() => {
    if (!shares) return [];
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return shares.filter(
      (s) =>
        s.revokedAt === undefined &&
        (s.expiresAt === undefined || s.expiresAt > now),
    );
  }, [shares]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      let expiresAt: number | undefined;
      if (expiryDate) {
        const parsed = new Date(`${expiryDate}T23:59:59`).getTime();
        if (Number.isFinite(parsed) && parsed > Date.now()) {
          expiresAt = parsed;
        }
      }
      const trimmedLabel = labelDraft.trim();
      const { shareId } = await createShare({
        resourceType,
        resourceId,
        accessLevel,
        expiresAt,
        name: trimmedLabel.length > 0 ? trimmedLabel : undefined,
      });
      const url = `${window.location.origin}/share/${shareId}`;
      await copyToClipboard(url);
      toast.success("Share link created", {
        description: "Link copied to clipboard.",
      });
      setExpiryDate("");
      setLabelDraft("");
    } catch (err) {
      toast.error("Could not create share link", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare({ shareId });
      toast.success("Share link revoked");
    } catch (err) {
      toast.error("Could not revoke link", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleRename = async (shareId: string, name: string | undefined) => {
    try {
      await renameShare({ shareId, name });
    } catch (err) {
      toast.error("Could not rename link", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      throw err;
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Share "{resourceName}"</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isChannel
              ? "Give guests a link to join the call — no sign-in required."
              : "Give guests a link to view or edit this resource."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-6">
          <form className="space-y-3" onSubmit={(e) => void handleCreate(e)}>
            <div className="space-y-1.5">
              <Label htmlFor="shareLabel">Label (optional)</Label>
              <Input
                id="shareLabel"
                type="text"
                placeholder='e.g. "Acme Corp review"'
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                maxLength={SHARE_NAME_MAX}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              {!isChannel && (
                <div className="space-y-1.5">
                  <Label htmlFor="accessLevel">Access level</Label>
                  <Select
                    value={accessLevel}
                    onValueChange={(v) => setAccessLevel(v as ShareAccessLevel)}
                  >
                    <SelectTrigger id="accessLevel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">Can view</SelectItem>
                      <SelectItem value="edit">Can edit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="expiresAt">Expires (optional)</Label>
                <Input
                  id="expiresAt"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              Create link & copy
            </Button>
          </form>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Active links</h3>
            {shares === undefined ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : activeShares.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active links yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {activeShares.map((s) => (
                  <ShareRow
                    key={s._id}
                    shareId={s.shareId}
                    name={s.name}
                    accessLevel={s.accessLevel}
                    expiresAt={s.expiresAt}
                    lastUsedAt={s.lastUsedAt}
                    onRevoke={() => void handleRevoke(s.shareId)}
                    onRename={(name) => handleRename(s.shareId, name)}
                  />
                ))}
              </ul>
            )}
          </div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ShareRow({
  shareId,
  name,
  accessLevel,
  expiresAt,
  lastUsedAt,
  onRevoke,
  onRename,
}: {
  shareId: string;
  name: string | undefined;
  accessLevel: ShareAccessLevel;
  expiresAt: number | undefined;
  lastUsedAt: number | undefined;
  onRevoke: () => void;
  onRename: (name: string | undefined) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/share/${shareId}`;

  const handleCopy = async () => {
    await copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="group flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 overflow-hidden">
        <InlineNameEdit
          name={name}
          onSave={onRename}
        />
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{accessLevelLabel(accessLevel)}</span>
          {expiresAt !== undefined && (
            <span>· expires {new Date(expiresAt).toLocaleDateString()}</span>
          )}
          {lastUsedAt !== undefined && (
            <span>· last used {new Date(lastUsedAt).toLocaleDateString()}</span>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => void handleCopy()}
        title={url}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-destructive"
        onClick={onRevoke}
        title="Revoke link"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

/**
 * Click-to-rename label for a share link. Click anywhere on the text or the
 * pencil icon to swap to an input; Enter or blur saves, Esc cancels. The
 * draft is local state so an in-flight remote update won't overwrite what the
 * user is typing.
 */
function InlineNameEdit({
  name,
  onSave,
}: {
  name: string | undefined;
  onSave: (name: string | undefined) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(name ?? "");
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : undefined;
    if (next === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // Toast is shown by caller; stay in edit mode so the user can retry.
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        maxLength={SHARE_NAME_MAX}
        disabled={saving}
        placeholder='e.g. "Acme Corp review"'
        className="h-7 px-1.5 py-0 text-sm"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className="-ml-1 flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={name ? "Rename link" : "Add a label"}
    >
      <span className={name ? "truncate" : "truncate italic text-muted-foreground"}>
        {name ?? "Untitled link"}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function accessLevelLabel(level: ShareAccessLevel): string {
  if (level === "edit") return "Can edit";
  if (level === "join") return "Join call";
  return "Can view";
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard can fail in insecure contexts — fall back silently.
  }
}
