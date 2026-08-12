import {
  ConfirmDialog,
  EmptyState,
  LoadingPane,
  PageHeader,
  SearchInput,
} from "@/components/console";
import { Button } from "@ripple/ui/components/button";
import { Card } from "@ripple/ui/components/card";
import { Tabs, TabsList, TabsTrigger } from "@ripple/ui/components/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ripple/ui/components/tooltip";
import { errorMessage } from "@/lib/errors";
import { fmtDate, fmtNum, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CopyIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Failure = FunctionReturnType<typeof api.admin.jobs.list>["failures"][number];

/**
 * Background work that gave up.
 *
 * Every retried pool and the outbound integration recorder report terminal
 * failure to one table (`backgroundJobFailures`), because these jobs have no
 * single row to hang a status off — a channel fanout spans a whole workspace,
 * an abandoned mirror belongs to a task whose write is precisely what failed.
 * This page is that table, and the operator console is its only home: the
 * table is platform-global by design, and most of its kinds are Ripple's own
 * denormalization falling behind, which no workspace admin could act on.
 *
 * Rows are a worklist, not an archive — dismissing is the only action, because
 * nothing here re-runs the work. A list that can never be emptied stops being
 * read, which would put this back where the 7-day logs were.
 */
export function JobsPage() {
  const data = useQuery(api.admin.jobs.list);
  const dismiss = useMutation(api.admin.jobs.dismiss);

  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [dismissing, setDismissing] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <LoadingPane />;

  const { failures, truncated } = data;

  // Kinds come from the data rather than a hardcoded list: a new pool that
  // starts reporting here should appear without this page being edited.
  const kinds = [...new Set(failures.map((f) => f.kind))].sort();
  const counts = new Map(kinds.map((k) => [k, failures.filter((f) => f.kind === k).length]));

  const needle = q.trim().toLowerCase();
  const visible = failures.filter((f) => {
    if (kind !== "all" && f.kind !== kind) return false;
    if (!needle) return true;
    return (
      f.kind.toLowerCase().includes(needle) ||
      f.key.toLowerCase().includes(needle) ||
      f.error.toLowerCase().includes(needle)
    );
  });

  const copyKey = (failure: Failure) => {
    void navigator.clipboard
      .writeText(failure.key)
      .then(() => toast.success("Key copied."))
      .catch(() => toast.error("Couldn't copy to the clipboard."));
  };

  const confirmDismiss = () => {
    if (!dismissing) return;
    setBusy(true);
    void dismiss({ failureId: dismissing._id })
      .then(() => {
        toast.success("Dismissed.");
        setDismissing(null);
      })
      .catch((err: unknown) => toast.error(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        subtitle={
          failures.length === 0
            ? "Nothing has given up."
            : `${fmtNum(failures.length)}${truncated ? "+" : ""} background ${
                failures.length === 1 ? "job" : "jobs"
              } gave up after exhausting retries.`
        }
      >
        {failures.length > 0 && (
          <SearchInput value={q} onValueChange={setQ} placeholder="Search job, key, error…" />
        )}
      </PageHeader>

      {kinds.length > 1 && (
        <Tabs
          value={kind}
          onValueChange={setKind}
          className="animate-rise"
          style={{ animationDelay: "40ms" }}
        >
          <TabsList>
            <TabsTrigger value="all" className="font-mono text-xs uppercase">
              all
              <span className="tabular-nums opacity-60">{failures.length}</span>
            </TabsTrigger>
            {kinds.map((k) => (
              <TabsTrigger key={k} value={k} className="font-mono text-xs">
                {opOf(k)}
                <span className="tabular-nums opacity-60">{counts.get(k)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* The cap is real, so say so. A silently-windowed worklist reads as
          "that's all of them", which is the opposite of this page's job. */}
      {truncated && (
        <p className="animate-rise text-xs text-muted-foreground">
          Showing the 200 most recent failures — older ones exist. Dismiss what you have handled to
          see further back.
        </p>
      )}

      <Card className="animate-rise gap-0 py-0" style={{ animationDelay: "80ms" }}>
        {visible.length === 0 ? (
          <EmptyState title={failures.length === 0 ? "All clear" : "Nothing to show"}>
            {failures.length === 0
              ? "No background job has exhausted its retries. Drains and outbound syncs are converging."
              : needle
                ? `No failures match “${q}”.`
                : "No failures of this kind."}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((failure) => (
                <FailureRow
                  key={failure._id}
                  failure={failure}
                  onCopyKey={() => copyKey(failure)}
                  onDismiss={() => setDismissing(failure)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={dismissing !== null}
        danger
        loading={busy}
        title="Dismiss this failure?"
        description={
          dismissing
            ? `The record is deleted — it is not retried, and nothing re-runs ${opOf(dismissing.kind)} for ${dismissing.key}. Dismiss once you have dealt with it.`
            : undefined
        }
        confirmLabel="Dismiss"
        onConfirm={confirmDismiss}
        onCancel={() => setDismissing(null)}
      />
    </div>
  );
}

function FailureRow({
  failure,
  onCopyKey,
  onDismiss,
}: {
  failure: Failure;
  onCopyKey: () => void;
  onDismiss: () => void;
}) {
  // `integrations.outbound:createIssue` → the op is what identifies the job at
  // a glance; the module is context, so it recedes.
  const [module, op] = splitKind(failure.kind);

  return (
    <TableRow className="group">
      <TableCell>
        <div className="font-mono text-sm">{op}</div>
        <div className="font-mono text-xs text-muted-foreground/70">{module}</div>
      </TableCell>

      <TableCell>
        <span className="font-mono text-xs text-muted-foreground">{failure.key}</span>
      </TableCell>

      <TableCell className="max-w-xs">
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="truncate text-left text-xs text-destructive">{failure.error}</div>
            }
          />
          <TooltipContent className="max-w-md">
            <span className="font-mono text-xs break-words">{failure.error}</span>
          </TooltipContent>
        </Tooltip>
      </TableCell>

      <TableCell>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="font-mono text-xs text-muted-foreground">
                {fmtRelative(failure.failedAt)}
              </span>
            }
          />
          <TooltipContent>{fmtDate(failure.failedAt)}</TooltipContent>
        </Tooltip>
      </TableCell>

      <TableCell>
        <div
          className={cn(
            "flex items-center justify-end gap-0.5 transition-opacity",
            // Hover-revealed on pointer devices only; always visible on touch.
            "md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
          )}
        >
          <IconAction label="Copy the key" onClick={onCopyKey}>
            <CopyIcon />
          </IconAction>
          <IconAction label="Dismiss" className="hover:text-destructive" onClick={onDismiss}>
            <XIcon />
          </IconAction>
        </div>
      </TableCell>
    </TableRow>
  );
}

function IconAction({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={className}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** `module:function` is the convention every reporter follows; tolerate a kind that doesn't. */
function splitKind(kind: string): [module: string, op: string] {
  const at = kind.lastIndexOf(":");
  return at === -1 ? ["", kind] : [kind.slice(0, at), kind.slice(at + 1)];
}

const opOf = (kind: string) => splitKind(kind)[1];
