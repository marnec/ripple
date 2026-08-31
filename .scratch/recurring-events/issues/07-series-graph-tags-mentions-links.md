# 07 — Series in the graph, tags, mentions, and occurrence links

**What to build:** The series takes its place as a first-class resource
everywhere a one-off event already is. One graph node per series, one set of
tags, one entry in `@`-mention autocomplete — so mentioning the standup in chat
means the ritual and not one Tuesday of it, and the picker is not flooded with a
hundred identically-named entries.

Occurrence URLs carry the original start alongside the series id. A notification
about one occurrence links with that coordinate; a notification about the series
links bare, and a bare link resolves to the next occurrence from now, falling
back to the last one when the series has ended, so an old link is never a dead
page.

The occurrence view states in one line that it repeats and how many remain, and
offers a way through to the series — so an organizer who notices a problem on a
Tuesday can fix the pattern from where they noticed it.

**Blocked by:** 03.

**Status:** done

- [x] A series appears once in the workspace graph, with its title synced on
      rename, and stays out of global search exactly as events do today.
- [x] Tagging a series tags the series, and the tag's resource lists show it once.
- [x] `@`-mention autocomplete offers the series once and resolves to it.
- [x] An occurrence URL carrying an original start opens that occurrence.
- [x] A bare series link opens the next upcoming occurrence, and the last one
      when the series has ended.
- [x] The occurrence view states that it repeats, how many remain, and links to
      the series.
- [x] A series that hosts its meeting in a channel gets the same venue edge an
      event does.
