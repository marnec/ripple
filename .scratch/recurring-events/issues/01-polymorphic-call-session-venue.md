# 01 — Prefactor: give call sessions a polymorphic venue

**What to build:** A call started from a standalone calendar event produces a
transcript document, which it does not today. A call session currently belongs
to a channel and nothing else, so an event that hosts its own meeting (rather
than borrowing a channel's room) has no session row and therefore no transcript
ingest path at all. Widen the session's venue so it can belong to an event as
well as a channel, and route the event join path through the same
join-or-start logic channels already use.

This is a prefactor: it is independently valuable, it closes an existing gap,
and it is what makes the series-call ticket a small change instead of a tangled
one. Nothing about recurrence appears in it.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A call joined from a standalone event creates a call-session row for that
      event, and a second joiner reuses it rather than minting a second meeting.
- [x] When that call ends, its transcript is ingested into a document linked to
      the session, exactly as a channel call's is.
- [x] Two successive calls on the same standalone event produce two sessions and
      two transcript documents — the second does not overwrite or silently skip
      because of the first.
- [x] Channel calls are unchanged: the same reuse behaviour, the same
      transcription-mode-decided-by-first-joiner rule, the same treatment of a
      stranded `active` row as a claim rather than a fact.
- [x] A guest arriving on a share link still cannot mint a call, only join one.
- [x] The existing call-session tests still pass, and new cases cover the event
      venue.
