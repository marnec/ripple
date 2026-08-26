/**
 * The push title for an @mention in a chat channel.
 *
 * Pure, so it is its own test surface — the title otherwise only exists inside
 * a workpool-scheduled action's arguments, where asserting on it means
 * asserting on a job queue.
 *
 * A DM is the interesting case. It stores no name (its label is derived from
 * its participants), so interpolating `#${channel.name}` rendered a dangling
 * "#". Deriving a label here would be wrong too: the label is viewer-relative
 * and this title is built once for every recipient. There is nothing worth
 * naming anyway — in a two-person conversation the sender is already in the
 * title and the only other participant is the person being notified.
 */
export function mentionTitle(
  actorName: string,
  channel: { type: string; name: string },
): string {
  return channel.type === "dm"
    ? `${actorName} mentioned you`
    : `${actorName} mentioned you in #${channel.name}`;
}
