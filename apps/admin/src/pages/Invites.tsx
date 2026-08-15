import {
  ConfirmDialog,
  EmptyState,
  LoadMore,
  LoadingPane,
  PageHeader,
  SearchInput,
} from "@/components/console";
import { inviteDeliveryNotice } from "@ripple/shared/inviteDelivery";
import { Badge } from "@ripple/ui/components/badge";
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
import { navigate } from "@/hooks/useHashRoute";
import { errorMessage } from "@/lib/errors";
import { fmtNum, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LinkIcon, SendIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Invite = FunctionReturnType<typeof api.admin.invites.list>["page"][number];

const FILTERS = ["pending", "accepted", "declined", "all"] as const;
type Filter = (typeof FILTERS)[number];

const PAGE_SIZE = 50;

export function InvitesPage() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<Id<"workspaceInvites"> | null>(null);
  const [revoking, setRevoking] = useState<Invite | null>(null);

  // The status filter is an argument, not a client-side predicate: it selects
  // the `by_status` index server-side. Changing tabs restarts pagination, which
  // is the point — filtering a loaded page would have hidden older pending
  // invites behind newer accepted ones, and a stuck pending invite is the whole
  // reason an operator opens this page.
  const {
    results: invites,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.admin.invites.list,
    filter === "all" ? {} : { status: filter },
    { initialNumItems: PAGE_SIZE },
  );
  const siteUrl = useQuery(api.admin.invites.siteUrl);
  const resend = useMutation(api.admin.invites.resend);
  const revoke = useMutation(api.admin.invites.revoke);

  if (status === "LoadingFirstPage") return <LoadingPane />;

  const needle = q.trim().toLowerCase();
  const visible = invites.filter((i) => {
    if (!needle) return true;
    return (
      i.email.toLowerCase().includes(needle) ||
      i.workspaceName?.toLowerCase().includes(needle) ||
      i.inviterName?.toLowerCase().includes(needle) ||
      i.inviterEmail?.toLowerCase().includes(needle)
    );
  });

  const onError = (err: unknown) => toast.error(errorMessage(err));

  const copyLink = (invite: Invite) => {
    void navigator.clipboard
      .writeText(`${siteUrl}/invite/${invite._id}`)
      .then(() => toast.success("Invite link copied."))
      .catch(() => toast.error("Couldn't copy to the clipboard."));
  };

  const doResend = (invite: Invite) => {
    setBusyId(invite._id);
    void resend({ inviteId: invite._id })
      .then(() => toast.success(`Invite re-sent to ${invite.email}.`))
      .catch(onError)
      .finally(() => setBusyId(null));
  };

  const confirmRevoke = () => {
    if (!revoking) return;
    const invite = revoking;
    setBusyId(invite._id);
    void revoke({ inviteId: invite._id })
      .then(() => {
        toast.success(`Invite to ${invite.email} revoked.`);
        setRevoking(null);
      })
      .catch(onError)
      .finally(() => setBusyId(null));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invites"
        subtitle={`${fmtNum(invites.length)} ${filter === "all" ? "" : filter + " "}loaded${
          status === "Exhausted" ? "" : " of more"
        }${needle ? " · search covers loaded invites only" : ""}`}
      >
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Search email, workspace, inviter…"
        />
      </PageHeader>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as Filter)}
        className="animate-rise"
        style={{ animationDelay: "40ms" }}
      >
        <TabsList>
          {/* No per-tab counts any more: each would be a deployment-wide count
              of a table with no aggregate behind it. The tab selects an index
              range instead. */}
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="font-mono text-xs uppercase">
              {f}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="animate-rise gap-0 py-0" style={{ animationDelay: "80ms" }}>
        {visible.length === 0 ? (
          <EmptyState title={needle ? "Nothing to show" : "No invites"}>
            {needle
              ? `No loaded ${filter === "all" ? "" : filter + " "}invites match “${q}”. Load more to widen the search.`
              : filter === "all"
                ? "No workspace invites have been sent yet."
                : `No ${filter} invites.`}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((invite) => (
                <InviteRow
                  key={invite._id}
                  invite={invite}
                  busy={busyId === invite._id}
                  canCopyLink={siteUrl !== null}
                  onCopyLink={() => copyLink(invite)}
                  onResend={() => doResend(invite)}
                  onRevoke={() => setRevoking(invite)}
                />
              ))}
            </TableBody>
          </Table>
        )}
        <LoadMore status={status} onLoadMore={loadMore} pageSize={PAGE_SIZE} />
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        danger
        loading={busyId !== null}
        title="Revoke this invite?"
        description={
          revoking
            ? `${revoking.email} will no longer be able to join ${revoking.workspaceName ?? "this workspace"} — the link in their email stops working. They can be invited again later.`
            : undefined
        }
        confirmLabel="Revoke invite"
        onConfirm={confirmRevoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

function InviteRow({
  invite,
  busy,
  canCopyLink,
  onCopyLink,
  onResend,
  onRevoke,
}: {
  invite: Invite;
  busy: boolean;
  canCopyLink: boolean;
  onCopyLink: () => void;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const pending = invite.status === "pending";
  const recipientUserId = invite.recipientUserId;
  const delivery = inviteDeliveryNotice(invite);

  return (
    <TableRow className="group">
      <TableCell>
        <div className="truncate font-mono">{invite.email}</div>
        {recipientUserId ? (
          <button
            onClick={() => navigate(`/users/${recipientUserId}`)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            has an account
          </button>
        ) : (
          <div className="text-xs text-muted-foreground/70">no account yet</div>
        )}
      </TableCell>

      <TableCell>
        {invite.workspaceName ? (
          <button
            onClick={() => navigate(`/workspaces/${invite.workspaceId}`)}
            className="max-w-40 truncate transition-colors hover:text-primary"
          >
            {invite.workspaceName}
          </button>
        ) : (
          <span className="text-muted-foreground/70">deleted</span>
        )}
      </TableCell>

      <TableCell>
        <button
          onClick={() => navigate(`/users/${invite.invitedBy}`)}
          className="max-w-40 truncate text-muted-foreground transition-colors hover:text-foreground"
        >
          {invite.inviterName ?? invite.inviterEmail ?? "Unknown"}
        </button>
      </TableCell>

      <TableCell>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={invite.status} />
          {pending && invite.recipientIsMember && (
            <Badge
              variant="outline"
              className="border-warning/30 text-warning"
              title="Already a member — this invite is stale"
            >
              stale
            </Badge>
          )}
          {/* The third explanation for a stuck invite, beside "already a
              member": the mail never arrived. Same mapper the product app
              uses, so the two consoles cannot disagree about what a delivery
              state means. */}
          {delivery && (
            <Badge
              variant="outline"
              className={
                delivery.tone === "error"
                  ? "border-destructive/30 text-destructive"
                  : "border-warning/30 text-warning"
              }
              title={delivery.detail ?? delivery.label}
            >
              {delivery.tone === "error" ? "undelivered" : "delayed"}
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell className="font-mono text-xs text-muted-foreground">
        {fmtRelative(invite.createdAt)}
      </TableCell>

      <TableCell>
        {pending ? (
          <div
            className={cn(
              "flex items-center justify-end gap-0.5 transition-opacity",
              // Hover-revealed on pointer devices only; always visible on touch.
              "md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
            )}
          >
            <IconAction
              label={canCopyLink ? "Copy invite link" : "SITE_URL isn't configured"}
              disabled={!canCopyLink}
              onClick={onCopyLink}
            >
              <LinkIcon />
            </IconAction>
            <IconAction label="Re-send the invite email" disabled={busy} onClick={onResend}>
              <SendIcon />
            </IconAction>
            <IconAction
              label="Revoke invite"
              disabled={busy}
              className="hover:text-destructive"
              onClick={onRevoke}
            >
              <XIcon />
            </IconAction>
          </div>
        ) : (
          <div className="text-right text-muted-foreground/50">—</div>
        )}
      </TableCell>
    </TableRow>
  );
}

function IconAction({
  label,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
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
            disabled={disabled}
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

function StatusBadge({ status }: { status: string }) {
  if (status === "accepted") {
    return <Badge className="bg-success/15 text-success">accepted</Badge>;
  }
  if (status === "declined") return <Badge variant="secondary">declined</Badge>;
  return <Badge variant="outline">pending</Badge>;
}
