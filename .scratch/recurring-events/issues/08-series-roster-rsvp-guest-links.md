# 08 — Invite people to a series: roster, RSVP, guest links

**What to build:** Invite someone once and they are invited to all of it.
Workspace members and external guests are both added to the series rather than
to an occurrence, RSVP once for the whole thing, and can be removed in one
action. Someone added after the series has started joins the standup, not one
instance of it.

A guest's share link lives as long as the series: for a series with an end, until
after its last occurrence; for an open-ended one, out to the horizon and
extending lazily whenever the guest actually uses it — so an indefinite
commitment never needs a new link, and an abandoned link still ages out.

Invitee rows gain an optional original-start field from day one, left unset and
meaning "the series", so that per-occurrence decline later becomes a UI and index
change rather than a migration of every roster.

**Blocked by:** 03.

**Status:** done

- [x] A member invited to a series sees every occurrence in their own calendar.
- [x] RSVP is recorded once and applies to every occurrence.
- [x] Someone invited after the series has started is invited to the whole
      remaining series.
- [x] Removing an invitee removes them from all of it in one action.
- [x] A guest invited to a bounded series has a link that works until after the
      last occurrence.
- [x] A guest invited to an open-ended series has a link that keeps working while
      they keep using it, and expires after disuse.
- [x] In-app notification of the invitation reaches members, and the roster
      respects the workspace-membership check.
- [x] The optional original-start field exists on invitee rows and is unset by
      every write path in this ticket.
