# 16 — Invite people while creating a repeating event

**What to build:** Choosing a repeat stops taking the invitee picker away.

Today the create form replaces it with the sentence "Repeating events can't be
shared with anyone yet — create it, then invite people from the event itself",
which sends the organizer somewhere that does not exist. The form was honest
when it was written — accepting invitees and dropping them at submit would have
been worse — but the roster it was waiting for is built, so the message is now
the only thing standing between an organizer and inviting their team to the
standup they are creating.

The picker stays exactly as it is for a one-off, the roster is carried into the
series on save, and the invitations go out then rather than needing a second
visit.

**Blocked by:** 14.

**Status:** done

- [x] The invitee picker is offered when a repeat is chosen, and behaves the
      same as it does for a one-off event.
- [x] Members and guests chosen at creation are on the series roster
      immediately after it is created.
- [x] Guests chosen at creation receive the one invitation carrying the whole
      pattern, and members receive the in-app notification.
- [x] Creating a one-off event is unchanged, down to the row it writes.
- [x] The "can't be shared with anyone yet" message is gone, and no path in the
      form promises something the product cannot do.
- [x] Creating a repeating event with nobody invited still works and mails
      nobody.
