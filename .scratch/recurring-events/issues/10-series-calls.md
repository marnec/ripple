# 10 — Series calls: one room, one session per occurrence

**What to build:** Every occurrence of the standup meets in the same room — the
join link an organizer shares once keeps working for the life of the series,
which is how a channel's persistent room already behaves. The room is created
lazily on the first join of any occurrence.

Each week's call is nonetheless its own call: it gets its own session and its own
transcript document, so last week's notes are not overwritten by this week's.
The session records which occurrence it happened in, resolved from the join
window at the moment the session is created. It is deliberately not *keyed* on
the occurrence — a call that starts three minutes early or runs twenty minutes
long must not have to decide what it is before it can exist.

**Blocked by:** 01, 03.

**Status:** done

- [x] Joining any occurrence of a series enters the same room, created on first
      join and reused thereafter.
- [x] Two calls on two different occurrences produce two sessions and two
      transcript documents.
- [x] A call that starts before its occurrence's join window opens, or runs past
      its end, still resolves to the right occurrence or degrades sensibly.
- [x] A series hosted in a channel reuses that channel's room, as an event does
      today.
- [x] The occurrence view offers the join control only inside the join window.
- [x] A guest on a share link can join an occurrence's call but cannot start one.

**Handoff to 08.** The last box is delivered as the *call* rule and is tested at
the venue seam (`findLiveMeetingForVenue` on a series venue joins a live call
and never mints one, exactly as it does for a channel and a standalone event).
The *share link* a series guest arrives on is ticket 08's: `resourceShares` has
no `eventSeries` resource type yet, so there is no guest action here to hang off
one. When 08 adds it, its guest token action calls
`findLiveMeetingForVenue(ctx, { kind: "series", seriesId }, rtk)` and must not
call `ensureMeetingForVenue`.
