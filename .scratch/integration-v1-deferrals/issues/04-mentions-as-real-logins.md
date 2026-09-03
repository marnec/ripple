# 04 — Mentions arrive on the provider as real @logins

**What to build:** A task comment or a description push that mentions a
person or an event reaches GitHub or GitLab with the mention intact. Today
the mention is dropped entirely, so "ping @Marco about this" arrives as
"ping  about this". After this ticket it arrives as `ping @marco-login` when
Marco has connected that provider (ticket 01/02), or as `ping Marco` in
plain text when they have not, which is exactly how Linear behaves. Event
mentions arrive as the event's title.

The markdown is rendered in the browser and posted alongside the BlockNote
JSON. The installed BlockNote honors an inline content spec's external-HTML
export during markdown conversion, so the two mention specs emit a stable
token (a user, event, or series kind plus the id, no markdown-special
characters). The outbound dispatch layer, which already knows the workspace
and provider at every push site, rewrites tokens just before enqueueing:
users through the existing identity matcher (login for GitHub, username for
GitLab), events and series through their titles. Comment create, comment
edit, and description push all go through the rewrite. Stored comment and
document content is untouched. Inbound `@login` to mention is out of scope.

Spec: `plans/integration-v1-deferrals.md`, plan D.

**Blocked by:** None — can start immediately. Real `@login` output needs a
connected member, which ticket 01 provides; without it the display-name
fallback is what's exercised.

**Status:** done

- [x] Exporting a comment with a user mention to markdown in the browser
      yields the token, never empty text (jsdom unit test).
- [x] A pushed comment mentioning a connected GitHub member contains
      `@<login>`; mentioning an unconnected member contains their display
      name without an `@`; an unknown id renders a visible unknown-user
      marker.
- [x] The same holds for GitLab, using the stored username.
- [x] Event and series mentions render their title; missing ones render a
      visible unknown-event marker.
- [x] No token ever reaches a provider: a test asserts the token grammar has
      no match on the dispatched body for create, edit, and description push.
- [x] Comment editing and the description sync button behave identically to
      comment creation.
- [x] Chat messages, which share the mention specs, are unaffected.
- [x] The doc comments that currently promise lossiness on the comment and
      description mutations are updated.
