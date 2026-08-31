# 14 — Invite people to a series, and remove them

**What to build:** Invite someone once and they are invited to all of it. An
organizer opens the series and can add workspace members and external guests,
see who is on the roster and what each of them has answered, and remove anyone
in a single action that removes them from every occurrence.

The behaviour behind this is already built and tested — the roster mutations,
the guest share whose link lives as long as the series, the single recurring
invitation a guest receives, and the in-app notification a member gets. None of
it has a way in from the product, which is what this ticket adds. It is the
ticket that closes the two user stories about inviting someone after a series
has started and removing them again.

The roster belongs to the **series**, never to one occurrence: there is no
per-occurrence invite control and adding one is a different feature.

**Blocked by:** 13.

**Status:** done

- [x] An organizer can add workspace members to a series and they appear on the
      roster.
- [x] An organizer can add an external guest by email, and that guest receives
      the one invitation carrying the whole repeating pattern.
- [x] Someone added after the series has started is invited to all of what
      remains, not to one instance.
- [x] An organizer can remove anyone from the series in one action, and the
      removed person is gone from every occurrence.
- [x] The roster shows each person's response, and distinguishes members from
      guests, exactly as a one-off event's does.
- [x] Someone who is not the organizer cannot change the roster.
- [x] The invitee cap is enforced with a message rather than a silent failure.
- [x] An **override** cannot be given a roster of its own. Ticket 17 found that
      the one-off `addInvitees` has no override guard, so an override's event id
      would write a graph edge from a node that does not exist. No product path
      does this today; this ticket is where "a roster belongs to the series"
      gets enforced rather than merely observed. (Added after publication —
      surfaced by ticket 17.)
