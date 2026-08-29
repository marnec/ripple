# 03 — Retire direct messages from the channel dialog, and call the axis Visibility

**What to build:** Creating a **channel** asks two things — a name, and a
**visibility** — and stops asking anything else. The direct-message option
leaves the dropdown, taking with it the conditional user picker, the conditional
title and description, the conditional button label, and both cross-field
validation rules that existed only to reconcile two forms sharing one component.
The form no longer changes shape as the member fills it in.

The privacy control is relabelled **Visibility**, and its options read **Public**
and **Private** — the words the browse page's filter has been using for this same
property all along. The values sent to the backend are unchanged; a single map
translates stored value to displayed label, and it lives in exactly one place so
that the two-vocabulary problem this ticket fixes cannot quietly return. The
explanatory sentence under each option stays: it is the part that tells a member
a private channel is still visible to the workspace and joinable by request,
rather than secret.

**Blocked by:** 02 — the new door must exist before the old one closes.

**Status:** ready-for-agent

- [x] The channel dialog offers exactly two visibilities and no direct-message
      option.
- [x] The field is labelled Visibility; the options read Public and Private.
- [x] Each option keeps an explanatory sentence, and the private one still makes
      clear the channel is visible to the workspace and joinable by request.
- [x] The name field is always present; no field appears or disappears based on
      the visibility chosen.
- [x] Creating a public channel lands the member in the channel; creating a
      private one lands them in its settings.
- [x] The name field is focused when the dialog opens.
- [x] Exactly one mapping from stored value to display label exists in the web
      app.
- [x] The direct-message branch, both cross-field validation rules, and every
      conditional title, description and button label are deleted rather than
      moved.
- [x] The two dialogs share no base component and no mode flag — only the
      responsive dialog primitive.

## Notes on completion

Scope widened by two files, deliberately. This ticket described the dialog, but
spec 0001's solution says the axis is called visibility *everywhere a channel's
privacy is named* — and two other surfaces named it: the channel details panel
("Type", "Open — any workspace member can join") and the search result badge
("Open" / "Closed"). Converting only the dialog would have left the
two-vocabulary problem alive, just relocated. Both now read from the same map,
which is what makes the "exactly one mapping" criterion true rather than merely
satisfied in one file.

The details panel labels a direct message "Conversation", not "Visibility" —
it has none, and offering the word would contradict the glossary.

The form field is named `visibility` internally and translated to the mutation's
`type` argument at the call. Spec 0002 renames the column, at which point the
translation disappears.

Remaining "Open"/"Closed" strings in the web app belong to pull request status
and comment thread status. Different axes, correctly untouched.
