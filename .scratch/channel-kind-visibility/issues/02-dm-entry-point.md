# 02 — A door for direct messages on the DMs sidebar section

**What to build:** A workspace member can start a **direct message** from the
sidebar. The DMs section header gains a `+`, mirroring the Channels section
directly above it, which opens a dialog asking only who they want to talk to.
Picking a person lands them in the conversation, ready to type.

Two things make this reachable rather than merely present. The section renders
even when the member has no conversations yet — today it disappears entirely,
so the feature is invisible to precisely the person who has never used it. And
the person picker is searchable, because finding a human in a workspace roster
is its whole job and a dropdown stops working somewhere around twenty people.

The mutation behind this already deduplicates and returns the existing
conversation when one is there, so picking someone you already talk to simply
takes you back to that thread. No branch is written for that case; only the
button's wording changes, from "Start conversation" to "Open conversation",
using conversation data the sidebar already holds.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] The DMs sidebar section header renders whether or not the member has any
      conversations.
- [x] A member with no conversations sees a single plain line saying so, and
      only while the section is expanded — a collapsed empty section is just its
      header.
- [x] A `+` on the DMs header opens the new dialog, matching the affordance the
      Channels header already has.
- [x] The dialog asks only for a person. No name field, no visibility, no other
      control.
- [x] The person list is searchable by typing and fully operable from the
      keyboard.
- [x] The signed-in member never appears in their own person list, and bot
      accounts never appear in anyone's.
- [x] Picking a person navigates to the conversation.
- [x] Picking a person the member already has a conversation with navigates to
      that existing conversation, with its history intact.
- [x] The button reads "Open conversation" when a conversation with the picked
      person already exists, and "Start conversation" otherwise.
- [x] A failed creation surfaces an error rather than leaving the dialog open
      and silent.
- [x] The picker is focused when the dialog opens.
- [x] The dialog presents correctly on a small screen, keeping the responsive
      behaviour the existing dialog has. *Confirmed by the user in the running app.*
- [x] Starting a direct message from the command palette continues to work
      exactly as before.

## Notes on completion

The shared combobox gained a `ref` prop so the dialog can focus it on open.
There was no prior art in this repo for passing a ref through base-ui's
`render={<Button/>}` pattern, so rather than assume the refs merge, a throwaway
test asserted the ref lands on the element carrying `role="combobox"`. It does.
The probe was deleted — spec 0001 keeps no component tests at this surface.

The `+` reveals on hover to match the Channels section, except when there are no
conversations, where it stays visible: hiding the only control in an otherwise
empty section would reintroduce exactly the discoverability problem this ticket
exists to fix.

Whether a conversation already exists is decided by matching the picked member's
display name against the labels of the DMs in the sidebar — a DM's label *is*
the other participant's name, so no second query is needed. Two members sharing
a display name would show "Open conversation" for one about to be created. That
is the entire consequence: the mutation decides for itself whether to reuse or
create, and the navigation is identical either way.

Resetting the picked member happens in the dialog's close handler rather than in
an effect watching `open` — the effect form costs an extra render pass on every
close, and this repo's lint rules reject it.
