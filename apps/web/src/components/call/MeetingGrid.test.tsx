import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CallMeetingGrid } from "./MeetingGrid";
import type { CallParticipant } from "./types";

/**
 * The one decision this module makes: which layout the meeting gets. A
 * camera grid until somebody shares a screen, then a stage with the share
 * on top and the cameras in a strip — for a remote sharer and for the
 * sharer themselves. The tiles' own rendering is not under test.
 */

interface FakeSelf {
  name: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoTrack: MediaStreamTrack | undefined;
  screenShareEnabled: boolean;
  screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack };
  registerVideoElement: () => void;
  deregisterVideoElement: () => void;
}

let fakeMeeting: {
  self: FakeSelf;
  participants: { joined: { toArray: () => CallParticipant[] } };
};

vi.mock("@cloudflare/realtimekit-react", () => ({
  useRealtimeKitSelector: (sel: (m: typeof fakeMeeting) => unknown) =>
    sel(fakeMeeting),
  useRealtimeKitMeeting: () => ({ meeting: fakeMeeting }),
}));

function fakeTrack(): MediaStreamTrack {
  return { id: Math.random().toString(36).slice(2), kind: "video" } as MediaStreamTrack;
}

function participant(
  overrides: Partial<CallParticipant> & { id: string; name: string },
): CallParticipant {
  return {
    videoEnabled: false,
    audioEnabled: true,
    videoTrack: fakeTrack(),
    screenShareEnabled: false,
    screenShareTracks: { audio: fakeTrack(), video: fakeTrack() },
    registerVideoElement: () => {},
    deregisterVideoElement: () => {},
    ...overrides,
  };
}

function setup(opts: { participants?: CallParticipant[]; selfSharing?: boolean } = {}) {
  fakeMeeting = {
    self: {
      name: "Me",
      videoEnabled: false,
      audioEnabled: true,
      videoTrack: undefined,
      screenShareEnabled: opts.selfSharing ?? false,
      screenShareTracks: { video: fakeTrack() },
      registerVideoElement: () => {},
      deregisterVideoElement: () => {},
    },
    participants: { joined: { toArray: () => opts.participants ?? [] } },
  };
}

const layout = () =>
  document.querySelector("[data-layout]")?.getAttribute("data-layout");

describe("CallMeetingGrid", () => {
  beforeEach(() => {
    // jsdom has no MediaStream; the share tile builds one around the track.
    vi.stubGlobal(
      "MediaStream",
      class {
        constructor(public tracks: MediaStreamTrack[]) {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the camera grid when nobody is sharing", () => {
    setup({ participants: [participant({ id: "a", name: "Ada" })] });
    render(<CallMeetingGrid />);
    expect(layout()).toBe("grid");
    expect(screen.queryByText(/is presenting/)).toBeNull();
  });

  it("puts a remote share on the stage and keeps every camera tile", () => {
    setup({
      participants: [
        participant({ id: "a", name: "Ada", screenShareEnabled: true }),
        participant({ id: "b", name: "Bob" }),
      ],
    });
    render(<CallMeetingGrid />);
    expect(layout()).toBe("stage");
    expect(screen.getByText("Ada is presenting")).toBeTruthy();
    // Cameras survive the switch: self + both remotes.
    expect(screen.getByText("Me (You)")).toBeTruthy();
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
  });

  it("shows the sharer their own share", () => {
    setup({ selfSharing: true });
    render(<CallMeetingGrid />);
    expect(layout()).toBe("stage");
    expect(screen.getByText("You are presenting")).toBeTruthy();
  });

  it("splits the stage between concurrent shares instead of picking one", () => {
    setup({
      selfSharing: true,
      participants: [participant({ id: "a", name: "Ada", screenShareEnabled: true })],
    });
    render(<CallMeetingGrid />);
    expect(screen.getByText("You are presenting")).toBeTruthy();
    expect(screen.getByText("Ada is presenting")).toBeTruthy();
  });
});
