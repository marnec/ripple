import { describe, expect, it } from "vitest";
import { partitionSection, sectionOf } from "./conversation-section";
import { ChannelKind, ChannelVisibility } from "@ripple/shared/enums/roles";

const publicChannel = { kind: ChannelKind.CHANNEL, visibility: ChannelVisibility.PUBLIC };
const privateChannel = { kind: ChannelKind.CHANNEL, visibility: ChannelVisibility.PRIVATE };
const dm = { kind: ChannelKind.DM, visibility: ChannelVisibility.PRIVATE };

const row = (id: string, isHidden: boolean) => ({ _id: id, isHidden });

describe("sectionOf", () => {
  it("partitions on kind, not visibility", () => {
    // A private channel and a direct message both store
    // `visibility: "private"`. Splitting on that would put every private
    // channel in the DMs section.
    expect(sectionOf(publicChannel)).toBe("channels");
    expect(sectionOf(privateChannel)).toBe("channels");
    expect(sectionOf(dm)).toBe("dms");
  });

  it("keeps a row with no kind out of the DMs section", () => {
    expect(sectionOf({})).toBe("channels");
  });
});

describe("partitionSection", () => {
  it("hides dismissed conversations by default and counts them", () => {
    const { visible, hiddenCount } = partitionSection(
      [row("a", false), row("b", true), row("c", false)],
      { includeHidden: false },
    );
    expect(visible.map((c) => c._id)).toEqual(["a", "c"]);
    expect(hiddenCount).toBe(1);
  });

  it("shows dismissed conversations when the toggle is engaged, still counting them", () => {
    // The count drives the toggle's own label, so it must not drop to zero the
    // moment the toggle is on — otherwise the control that revealed them
    // disappears and there is no way back.
    const { visible, hiddenCount } = partitionSection(
      [row("a", false), row("b", true)],
      { includeHidden: true },
    );
    expect(visible.map((c) => c._id)).toEqual(["a", "b"]);
    expect(hiddenCount).toBe(1);
  });

  it("counts only the section it was given", () => {
    // The bug this replaces: the server returned one `hiddenChannelCount`
    // across both sections, so dismissing a direct message incremented the
    // count rendered on the *Channels* header — and that header's eye was the
    // only control able to bring the conversation back. Counting per section
    // is what makes each toggle describe its own rows.
    const conversations = [
      { ...publicChannel, _id: "chan", isHidden: false },
      { ...dm, _id: "dm-hidden", isHidden: true },
    ];

    const channels = partitionSection(
      conversations.filter((c) => sectionOf(c) === "channels"),
      { includeHidden: false },
    );
    const dms = partitionSection(
      conversations.filter((c) => sectionOf(c) === "dms"),
      { includeHidden: false },
    );

    expect(channels.hiddenCount, "a closed conversation is not a hidden channel").toBe(0);
    expect(dms.hiddenCount).toBe(1);
  });

  it("treats an unloaded section as empty rather than throwing", () => {
    const { visible, hiddenCount } = partitionSection(undefined, { includeHidden: false });
    expect(visible).toEqual([]);
    expect(hiddenCount).toBe(0);
  });
});
