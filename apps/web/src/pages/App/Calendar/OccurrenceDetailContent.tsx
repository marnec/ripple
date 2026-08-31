/**
 * Shared body for the occurrence detail surfaces — the field stack both
 * `OccurrenceDetailSheet` (desktop side panel) and `OccurrenceDetailPage`
 * (mobile destination, desktop "expand") display verbatim, plus the two
 * questions every edit here passes through.
 *
 * ## Why the series has no page of its own
 *
 * It used to: `/events/:id/series` held the name, the description, the venue,
 * the tags and the roster, and an occurrence held the date and the pattern.
 * Nothing forced the split — an occurrence *is* the series on a date — and the
 * cost of it was two pages that each answered half of "what is this meeting",
 * and a "View series" link the organizer had to know to follow. So the series'
 * own fields live here, on the occurrence the organizer actually clicked, and
 * what would have been a navigation is now a scope question they were going to
 * be asked anyway.
 *
 * Which is the one thing the merge has to keep honest: with every field on one
 * surface, nothing about a field's *position* says whether editing it changes
 * one Tuesday or all of them. The scope dialog says it instead, for every edit
 * and not just the ambiguous ones, and it lists the scopes a given field
 * cannot use as disabled rather than hiding them — see `edit-scope.ts`.
 */
import { CalendarClock, Hash, Repeat } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@ripple/ui/components/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TagInput } from "@/components/TagInput";
import { cn } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";
import type { RecurrenceRule } from "@ripple/shared/recurrence";

import { EditableDescription, ReadSection } from "./event-detail-blocks";
import { EditScopeDialog } from "./EditScopeDialog";
import { TimeSelect } from "./event-fields";
import { InviteeRoster } from "./InviteeRoster";
import { NotifyInviteesDialog } from "./NotifyInviteesDialog";
import { RecurrenceDialog } from "./RecurrenceDialog";
import { describeRule } from "./recurrence-presets";
import { describeOccurrenceInSeries } from "./occurrence-summary";
import { toSeriesDefinition } from "./series-definition";
import { formatOccurrenceWhen, type useOccurrenceDetail } from "./occurrence-detail-data";

type Detail = ReturnType<typeof useOccurrenceDetail> & {
  series: NonNullable<ReturnType<typeof useOccurrenceDetail>["series"]>;
};

export function OccurrenceDetailContent({
  detail,
  workspaceId,
  gapClassName = "gap-5",
  descriptionRows = 3,
}: {
  detail: Detail;
  workspaceId: Id<"workspaces">;
  /** The page uses a roomier column (`gap-7`) than the sheet (`gap-5`). */
  gapClassName?: string;
  descriptionRows?: number;
}) {
  const navigate = useNavigate();
  const {
    series,
    channel,
    invitees,
    members,
    editable,
    originalStartMs,
    endsAt,
    now,
    pending,
    setRepeatOpen,
    propose,
    proposeTags,
    proposeAddInvitees,
    proposeRemoveInvitee,
    proposeSelfInvite,
  } = detail;

  const rule = series.rule as RecurrenceRule;
  // The tags as the organizer last left them: the pending set while the scope
  // question is open, because the series row still holds the old one until it
  // is answered, and cancelling the question must put the chip back.
  const tags =
    pending?.kind === "series" && pending.change.field === "tags"
      ? pending.change.tags
      : (series.tags ?? []);
  const pendingAnchorTime = pending?.kind === "rule" ? pending.fields.anchorTime : undefined;

  return (
    <div className={cn("flex flex-col", gapClassName)}>
      {/* ───── When. Read-only: an occurrence's time is the rule's, and the
             two ways to change it are the anchor control at the bottom and a
             drag on the calendar. ───── */}
      <ReadSection
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        label={originalStartMs === null ? "Repeats" : "When"}
      >
        {originalStartMs !== null && endsAt !== null && (
          <p className="text-sm">{formatOccurrenceWhen(originalStartMs, endsAt)}</p>
        )}
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Repeat className="h-3.5 w-3.5 shrink-0" />
          {describeOccurrenceInSeries(toSeriesDefinition(series), originalStartMs ?? now)}
        </p>
        {originalStartMs === null && (
          <p className="mt-1 text-sm text-muted-foreground">This series has no occurrence left.</p>
        )}
      </ReadSection>

      {editable ? (
        <EditableDescription
          value={series.description ?? ""}
          rows={descriptionRows}
          onSave={(description) => propose({ kind: "content", fields: { description } })}
        />
      ) : series.description ? (
        <ReadSection label="Description">
          <p className="whitespace-pre-wrap text-sm">{series.description}</p>
        </ReadSection>
      ) : null}

      {/* The venue, read-only here as it always has been on a series: it is
          picked at creation and changing it is not a scoped edit anyone has
          asked for. */}
      {series.channelId && channel && (
        <ReadSection icon={<Hash className="h-3.5 w-3.5" />} label="Hosted in">
          <button
            type="button"
            className="flex items-center gap-2 self-start text-sm hover:underline"
            onClick={() => void navigate(`/workspaces/${workspaceId}/channels/${series.channelId}`)}
          >
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{channel.name}</span>
          </button>
        </ReadSection>
      )}

      {/* Tags belong to the series and to nothing else: one set for the
          ritual, never one per Tuesday (ADR 0002). The scope question is what
          says so, now that they are edited from an occurrence. */}
      {editable ? (
        <ReadSection label="Tags">
          <TagInput
            value={tags}
            onChange={proposeTags}
            workspaceId={workspaceId}
            placeholder="Add tags…"
          />
        </ReadSection>
      ) : tags.length > 0 ? (
        <ReadSection label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </ReadSection>
      ) : null}

      {/* One roster for the whole ritual. Invite someone once and they are
          invited to all of it; remove them once and they are gone from all of
          it — a roster row is filed under the series, never under one Tuesday
          of it (ADR 0002).

          Held back until the roster query answers: it is a second query and
          lands after the series, and "No one invited yet" is a claim that
          would be wrong for as long as it took to arrive. */}
      {invitees !== undefined && (
        <InviteeRoster
          invitees={invitees}
          editable={editable}
          members={members}
          organizerId={series.createdBy}
          onAdd={proposeAddInvitees}
          onRemove={proposeRemoveInvitee}
          onSelfInvite={
            invitees.some((i) => i.userId === series.createdBy) ? undefined : proposeSelfInvite
          }
        />
      )}

      {/* ───── The pattern itself. Both controls here are rule edits, so both
             go through the same on-save question as a rename does. ───── */}
      <section className="flex flex-col gap-3 border-t pt-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Repeat className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm">{describeRule(rule, new Date(originalStartMs ?? now))}</span>
          {editable && (
            <Button variant="outline" size="sm" onClick={() => setRepeatOpen(true)}>
              Change repeat
            </Button>
          )}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Starts at ({series.timezone})</span>
            <TimeSelect
              // Show the picked time while the scope question is open — the
              // series row still holds the old one until it is answered.
              value={pendingAnchorTime ?? series.anchorTime}
              onChange={(anchorTime) => {
                if (!anchorTime || anchorTime === series.anchorTime) return;
                propose({ kind: "rule", fields: { anchorTime } });
              }}
              triggerClassName="w-32"
            />
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The questions, hoisted out of the field stack so a shell can render them as
 * a **sibling** of its Sheet rather than a child of it. Two overlays nested
 * one inside the other end up fighting over focus and stacking order — the
 * same reason `EventDetailSheet` keeps its ConfirmDialog outside the Sheet.
 */
export function OccurrenceDetailDialogs({ detail }: { detail: Detail }) {
  const {
    series,
    originalStartMs,
    overrideCounts,
    pending,
    setPending,
    pendingNotify,
    setPendingNotify,
    repeatOpen,
    setRepeatOpen,
    confirmingDelete,
    setConfirmingDelete,
    applyScope,
    commit,
    propose,
    deleteSeries,
    now,
  } = detail;
  const rule = series.rule as RecurrenceRule;

  return (
    <>
      {repeatOpen && (
        <RecurrenceDialog
          open
          onOpenChange={setRepeatOpen}
          date={new Date(originalStartMs ?? now)}
          anchor={{
            date: series.anchorDate,
            time: series.anchorTime,
            timezone: series.timezone,
            durationMs: series.durationMs,
          }}
          initialRule={rule}
          onConfirm={(next) => {
            setRepeatOpen(false);
            propose({ kind: "rule", fields: { rule: next } });
          }}
        />
      )}

      {pending && (
        <EditScopeDialog
          open
          onOpenChange={(next) => {
            if (!next) setPending(null);
          }}
          kind={pending.kind}
          hasOccurrence={originalStartMs !== null}
          overrideCounts={overrideCounts}
          onConfirm={applyScope}
        />
      )}

      {/* The second question, and only when its answer is not already known:
          the edit reaches somebody's future and there is somebody to tell. */}
      {pendingNotify && (
        <NotifyInviteesDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingNotify(null);
          }}
          eventTitle={series.title}
          summary={pendingNotify.summary}
          onChoose={(choice) => {
            if (choice === "revert") {
              // Backing out of the question backs out of the edit: nothing
              // has been written yet.
              setPendingNotify(null);
              return;
            }
            void commit(pendingNotify.scope, pendingNotify.edit, choice === "send");
          }}
        />
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void deleteSeries()}
        title="Delete this series?"
        description="Every occurrence will be removed, past ones included. This cannot be undone."
        confirmLabel="Delete series"
        dismissLabel="Keep series"
      />
    </>
  );
}
