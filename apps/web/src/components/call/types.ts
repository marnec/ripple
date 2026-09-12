/**
 * Structural type matching the subset of the Cloudflare RealtimeKit
 * participant object that our tile/grid primitives consume. We type it
 * structurally rather than importing the SDK's full `Participant`
 * interface so the primitives stay decoupled from a specific RTK
 * version's surface.
 */
export interface CallParticipant {
  id: string;
  name: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoTrack: MediaStreamTrack;
  /**
   * Screen share is a separate producer from the camera. The SDK exposes
   * it as raw tracks (there is no `registerScreenShareElement`), so the
   * stage attaches `screenShareTracks.video` to a `<video>` itself.
   * Share audio is played by `RtkParticipantsAudio`, not by the tile.
   */
  screenShareEnabled: boolean;
  screenShareTracks: { audio: MediaStreamTrack; video: MediaStreamTrack };
  customParticipantId?: string;
  picture?: string;
  registerVideoElement: (el: HTMLVideoElement) => void;
  deregisterVideoElement: (el?: HTMLVideoElement) => void;
}
