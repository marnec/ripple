# 18 — Organizer self-invite for a series

**What to build:** The organizer of a series can put themselves on its roster in
one click, and is not on it until they do.

This is the parity the one-off event already has, and the reason for it is the
graph rather than the guest list: an organizer is connected to every meeting
they book, so adding that edge automatically would wire them to everything and
tell the graph nothing. Leaving it opt-in keeps the picture meaningful while
making the opt-in cheap. The ghost row at the top of the roster is that click.

It follows the same rules as the one-off event's: the organizer only, no
notification to anyone including themselves, already-accepted the moment it is
created, idempotent if clicked twice, and counted against the same invitee cap
so it cannot be used to step past it.

The roster component already carries the slot this renders into.

**Blocked by:** 17.

**Status:** done

- [x] The organizer of a series sees the self-invite affordance when they are
      not on its roster, and it disappears once they are.
- [x] Using it adds them at accepted, without notifying anyone.
- [x] Using it twice changes nothing the second time.
- [x] It respects the invitee cap rather than slipping past it.
- [x] Nobody but the organizer can use it.
- [x] It reappears if the organizer later removes their own row.
- [x] The one-off event's self-invite behaviour is unchanged.
