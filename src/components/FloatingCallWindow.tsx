import {
  RealtimeKitProvider,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { Eye, LogOut, Maximize2, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveCall } from "../contexts/ActiveCallContext";
import { useFollowMode } from "../contexts/FollowModeContext";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";

const PIP_WIDTH_LG = 320;
const PIP_WIDTH_SM = 240;
const PIP_HEIGHT_LG = 200;
const PIP_HEIGHT_SM = 150;
const BREAKPOINT = 480;
const MARGIN = 16;

function getPipSize() {
  const isSmall = window.innerWidth < BREAKPOINT;
  return {
    width: isSmall ? PIP_WIDTH_SM : PIP_WIDTH_LG,
    height: isSmall ? PIP_HEIGHT_SM : PIP_HEIGHT_LG,
  };
}

function FloatingCallContent() {
  const { meeting } = useRealtimeKitMeeting();
  const { leaveCall, returnToCall } = useActiveCall();
  const { startFollowing, isFollowing, followingUserId } = useFollowMode();

  const audioEnabled = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const videoEnabled = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const videoTrack = useRealtimeKitSelector((m) => m.self.videoTrack);
  const participants = useRealtimeKitSelector((m) =>
    m.participants.joined.toArray(),
  );

  const selfVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = selfVideoRef.current;
    if (!el) return;
    meeting.self.registerVideoElement(el, true);
    return () => {
      meeting.self.deregisterVideoElement(el, true);
    };
  }, [meeting.self, videoTrack]);

  const toggleAudio = useCallback(async () => {
    if (audioEnabled) {
      await meeting.self.disableAudio();
    } else {
      await meeting.self.enableAudio();
    }
  }, [meeting.self, audioEnabled]);

  const toggleVideo = useCallback(async () => {
    if (videoEnabled) {
      await meeting.self.disableVideo();
    } else {
      await meeting.self.enableVideo();
    }
  }, [meeting.self, videoEnabled]);

  // Show first remote participant's video if available
  const firstRemote = participants[0];
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!firstRemote) return;
    const el = remoteVideoRef.current;
    if (!el) return;
    firstRemote.registerVideoElement(el);
    return () => {
      firstRemote.deregisterVideoElement(el);
    };
  }, [firstRemote, firstRemote?.videoTrack]);

  const firstRemoteUserId = firstRemote?.customParticipantId;
  const isFollowingFirst =
    isFollowing && followingUserId === firstRemoteUserId;

  return (
    <>
      {/* Main video area */}
      <div className="group/pip relative flex-1 overflow-hidden bg-muted">
        {/* Show remote participant as main view, or self if alone */}
        {firstRemote?.videoEnabled ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        ) : videoEnabled ? (
          <video
            ref={selfVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full -scale-x-100 object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-xs text-muted-foreground">
              {participants.length + 1} in call
            </span>
          </div>
        )}

        {/* Self PiP inset (only when showing remote) */}
        {firstRemote && videoEnabled && (
          <div className="absolute bottom-1.5 right-1.5 h-12 w-16 overflow-hidden rounded border border-border/50 bg-muted shadow-sm">
            <video
              ref={selfVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
          </div>
        )}

        {/* Follow button on remote participant (top-left, show on hover) */}
        {firstRemoteUserId && !isFollowingFirst && (
          <button
            className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/pip:opacity-100"
            onClick={() =>
              startFollowing(
                firstRemoteUserId as Id<"users">,
                firstRemote.name || "Participant",
              )
            }
            title={`Follow ${firstRemote.name}`}
          >
            <Eye className="h-2.5 w-2.5" />
            Follow
          </button>
        )}

        {/* Following badge */}
        {isFollowingFirst && (
          <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-blue-500/80 px-1.5 py-0.5 text-[10px] text-white">
            <Eye className="h-2.5 w-2.5" />
            Following
          </div>
        )}

        {/* Participant count badge */}
        {participants.length > 1 && (
          <div className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            +{participants.length - 1}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-1 border-t bg-background/95 px-2 py-1.5">
        <div className="flex gap-1">
          <Button
            variant={audioEnabled ? "ghost" : "destructive"}
            size="icon"
            className="h-7 w-7"
            onClick={() => void toggleAudio()}
            title={audioEnabled ? "Mute" : "Unmute"}
          >
            {audioEnabled ? (
              <Mic className="h-3.5 w-3.5" />
            ) : (
              <MicOff className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant={videoEnabled ? "ghost" : "destructive"}
            size="icon"
            className="h-7 w-7"
            onClick={() => void toggleVideo()}
            title={videoEnabled ? "Turn off camera" : "Turn on camera"}
          >
            {videoEnabled ? (
              <Video className="h-3.5 w-3.5" />
            ) : (
              <VideoOff className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={returnToCall}
            title="Return to call"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="h-7 w-7"
            onClick={() => void leaveCall()}
            title="Leave call"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
}

export function FloatingCallWindow() {
  const { meeting, isFloating } = useActiveCall();

  // Responsive PIP size
  const [pipSize, setPipSize] = useState(getPipSize);

  // Drag state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Snap to bottom-right whenever the PIP becomes visible
  useEffect(() => {
    if (!isFloating) return;
    const size = getPipSize();
    setPipSize(size);
    setPosition({
      x: Math.max(MARGIN, window.innerWidth - size.width - MARGIN),
      y: Math.max(MARGIN, window.innerHeight - size.height - MARGIN),
    });
  }, [isFloating]);

  // Re-clamp position and update size when viewport resizes
  useEffect(() => {
    const onResize = () => {
      const size = getPipSize();
      setPipSize(size);
      setPosition((prev) => ({
        x: Math.max(0, Math.min(prev.x, window.innerWidth - size.width - MARGIN)),
        y: Math.max(0, Math.min(prev.y, window.innerHeight - size.height - MARGIN)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the window chrome, not from buttons
    if ((e.target as HTMLElement).closest("button")) return;
    dragging.current = true;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const { width, height } = getPipSize();
    const x = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - width));
    const y = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - height));
    setPosition({ x, y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    setIsDragging(false);
  }, []);

  if (!isFloating || !meeting) return null;

  return createPortal(
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
      style={{
        width: pipSize.width,
        height: pipSize.height,
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <RealtimeKitProvider value={meeting}>
        <FloatingCallContent />
      </RealtimeKitProvider>
    </div>,
    document.body,
  );
}
