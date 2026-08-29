# Channel creation speaks "Visibility"; direct messages get their own door

> Status: ready-for-agent. Unit one of two. Ships against the current schema;
> has no dependency on spec 0002.

## Problem Statement

Creating a **channel** and starting a **direct message** are the same dialog
today, and it shows. A single "Type" dropdown offers "Open Channel", "Closed
Channel", and "Direct Message", so the user is asked to classify *what kind of
thing they are making* and *who may enter it* in one control — and half the
form disappears or reappears depending on the answer. Picking "Direct Message"
retitles the dialog, swaps the name field for a user picker, and relabels the
button, which means the user has to commit to a choice before they can see what
the form for that choice looks like.

The words are wrong in a second way. This dropdown says "Open" and "Closed",
while the browse page's filter for the same property says "Public" and
"Private". One axis, two vocabularies, and neither surface knows about the
other.

Meanwhile the sidebar's DMs section has no way to start a DM. Its header carries
no `+`, unlike the Channels section right above it, and the section is not
rendered at all when the user has no DMs — so the one user who most needs to
start their first conversation is the one user for whom the feature is
completely invisible. The only existing path is the command palette, which the
user must already know about.

## Solution

Split the dialog in two. Creating a channel asks for a name and a
**visibility** — **Public** or **Private** — and nothing else. Starting a direct
message is a separate dialog reached from a `+` on the DMs section header,
mirroring the Channels section, and asks only who you want to talk to.

The DMs section header renders whether or not the user has any conversations, so
the `+` is reachable from a cold start. The person picker is searchable rather
than a dropdown, because its entire purpose is finding a human in a list that
grows with the workspace.

Everywhere a channel's privacy is named, it is called **visibility**, with the
values **Public** and **Private** — the words the browse filter already used.

## User Stories

1. As a workspace member, I want the channel creation dialog to ask only about
   channels, so that I am not choosing between two unrelated things in one
   control.
2. As a workspace member, I want the privacy control to be labelled
   "Visibility", so that its name says what it decides.
3. As a workspace member, I want the visibility options to read "Public" and
   "Private", so that they match the words the browse page uses for the same
   property.
4. As a workspace member, I want each visibility option to keep its explanatory
   sentence, so that I understand that a private channel is still *visible* to
   the workspace and joinable by request, rather than secret.
5. As a workspace member, I want the channel name field always present in the
   channel dialog, so that the form does not change shape as I make choices.
6. As a workspace member creating a public channel, I want to land in the
   channel after creating it, so that I can start talking immediately.
7. As a workspace member creating a private channel, I want to land in its
   settings after creating it, so that I can invite the people it is for.
8. As a workspace member, I want a `+` on the DMs section header, so that
   starting a conversation is where I would look for it — the same place the
   Channels section puts it.
9. As a workspace member with no direct messages yet, I want the DMs section to
   still be visible, so that I can discover that direct messages exist at all.
10. As a workspace member with no direct messages, I want the empty section to
    say so plainly when I expand it, so that I can tell the difference between
    "no conversations" and "still loading".
11. As a workspace member who never uses direct messages, I want the empty
    section to stay quiet when collapsed, so that my sidebar is not permanently
    occupied by a feature I do not use.
12. As a workspace member starting a direct message, I want a dialog that asks
    only who I want to talk to, so that there is nothing else to decide.
13. As a workspace member in a large workspace, I want to type to filter the
    person list, so that I am not scrolling a dropdown of everyone.
14. As a workspace member, I want to pick a person with the keyboard alone, so
    that starting a conversation does not require the mouse.
15. As a workspace member, I want to never see myself in the person list, so
    that I cannot attempt a conversation the server will refuse.
16. As a workspace member, I want bot accounts kept out of the person list, so
    that the picker only offers people I can actually talk to.
17. As a workspace member picking someone I already have a conversation with, I
    want the button to say "Open conversation", so that I know I am returning to
    an existing thread rather than starting a second one.
18. As a workspace member picking someone new, I want the button to say "Start
    conversation", so that I know a new thread is about to exist.
19. As a workspace member, I want to land in the conversation after picking a
    person, so that I can type my first message without another click.
20. As a workspace member who picks someone I already talk to, I want to land in
    that existing conversation, so that my history is intact.
21. As a workspace member, I want the direct message dialog to be reachable only
    from the DMs section, so that the two entry points do not compete.
22. As a workspace member who uses the command palette, I want starting a DM
    from there to keep working exactly as it does now, so that my existing habit
    is not broken by the new button.
23. As a workspace member, I want a failed creation to tell me so, so that I do
    not sit looking at a dialog that silently did nothing.
24. As a mobile workspace member, I want both dialogs to present as they do
    today on a small screen, so that the change does not cost me the responsive
    behaviour I already have.
25. As a workspace member, I want the channel name field focused when the
    channel dialog opens, so that I can type immediately.
26. As a workspace member, I want the person picker focused when the direct
    message dialog opens, so that I can type a name immediately.
27. As a developer, I want the create-channel mutation to refuse to make a
    direct message, so that removing the option from the form actually closes
    the path rather than merely hiding it.
28. As a developer, I want a direct message to remain unable to exist without
    its two participants, so that the code deriving a DM's label from its roster
    can keep assuming a roster is there.

## Implementation Decisions

**The dialog splits into two components with no shared base.** The existing
create-channel dialog loses its direct-message branch entirely; a new
create-DM dialog is written alongside it. They share only the responsive dialog
primitive. There is no `mode` prop and no common parent — the two forms have
different fields, different validation, different titles, different buttons, and
different post-submit navigation, which is the whole reason they are being
separated. The conditional titles, conditional descriptions, conditional button
labels, conditional fields, and both cross-field validation refinements delete
rather than move.

**"Visibility" is a label change only, not a data change in this unit.** The
form field is relabelled and its options read Public and Private, but the values
submitted to the backend remain `open` and `closed`. Translation between the two
lives in exactly one place — a single map from stored value to display label —
so that the two-vocabulary problem this unit is fixing cannot silently
reappear. Spec 0002 renames the stored values, at which point that map collapses
to identity and is deleted.

**The DMs sidebar section renders unconditionally.** Its current early return
when the conversation list is empty is removed, because a header action on a
header that does not exist is unreachable. The empty state is a single line of
muted text rendered only inside the expanded section — the collapsed header
alone is the cost paid by a user with no DMs.

**The DM `+` is a sidebar menu action on the DMs header**, matching the Channels
section's affordance, and opens the new dialog.

**The person picker is a combobox, not a select.** The workspace roster is
returned unpaginated and is unbounded in principle; a dropdown over it stops
being usable at around twenty people. Self and bot accounts are already excluded
by the roster query and the existing client-side filter; both are retained.

**No "already exists" branch is written.** The create-DM mutation already
deduplicates and returns the existing conversation's id, including the case
where the other participant's account was replaced and matched by email. The UI
therefore always calls the same mutation and always navigates to whatever it
returns. The only concession to the existing-conversation case is the button
label, derived from the sidebar data the component already has — a display
decision, never a branch in behaviour.

**The create-channel mutation's argument validator narrows to the two channel
visibilities**, rejecting `dm`. This is the one server-side change in this unit
and it is not optional: without it, removing the option from the form leaves a
public mutation able to mint a direct message with no participants, which the
label-derivation and deduplication code both assume cannot exist. This same
narrowing is also the first step of spec 0002; it is done once, here.

**The command palette's existing direct-message path is untouched.** It calls
the same mutation and remains a legitimate second entry point.

## Testing Decisions

**What makes a good test here.** Tests assert what a caller can observe: which
mutations refuse which arguments, and what rows exist afterwards. They do not
assert which component rendered which element, nor the internal shape of the
form. A test that would fail if the dialog were restyled is testing the wrong
thing.

**One seam: the Convex function surface.** Tests run through `convex-test`
against the public mutations, using the existing workspace-and-admin setup
helpers. This is the highest seam available for the one behavioural change in
this unit, and it is the seam the neighbouring behaviour is already tested at.

**Modules under test:** the create-channel mutation only.

**New coverage:** the create-channel mutation rejects a direct-message type
argument. Because the validator rejects it before the handler runs, this asserts
a validation failure rather than a thrown application error.

**Existing coverage that must keep passing unchanged:** the per-workspace
channel limit tests, which already assert that direct messages are excluded from
the count and that a workspace at its channel limit can still create one; and
the create-DM tests, which already assert deduplication, self-DM refusal, and
that direct messages cannot be renamed or gain members.

**Prior art:** the channel-limit tests exercise this exact mutation and are the
file the new case belongs beside. The create-DM tests are the model for
asserting mutation refusals.

**Deliberately untested:** the dialog split, the visibility labels, the DMs
section empty state, and the button label. These are presentation; the component
testing library and existing component tests are available if this judgement is
later reversed, but locking a label into a test buys less than it costs.

## Out of Scope

- Any schema, column, or index change. All of that is spec 0002.
- Renaming the stored `open` / `closed` values. Spec 0002.
- Renaming the per-user dismissal module. Spec 0002.
- Group direct messages, or any conversation with more than two participants.
- Changing how private channels are discovered or joined; the join-request flow
  is untouched.
- Changing the command palette.
- Changing what a direct message is called in the sidebar, or how its label is
  derived from its participants.
- Any change to the per-workspace channel limit or what counts toward it.

## Further Notes

The visibility explanatory text is the part of the current form that carries the
real meaning, and it should survive the rewrite intact: a **private** channel is
not a secret one. Every workspace member can see it exists and can ask to join
it. The word "Private" is doing less work than users will assume, and the
sentence beneath it is what corrects them.

This unit is deliberately shippable alone. The DM `+` is the user-visible payoff
and it should not wait behind a three-deploy migration of a live table.
