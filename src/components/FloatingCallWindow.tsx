import {
  RealtimeKitProvider,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from "@cloudflare/realtimekit-react";
import { LogOut, Maximize2, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveCall } from "../contexts/ActiveCallContext";
import { Button } from "./ui/button";

const PIP_WIDTH = 320;
const PIP_HEIGHT = 200;
const MARGIN = 16;

function FloatingCallContent() {
  const { meeting } = useRealtimeKitMeeting();
  const { leaveCall, returnToCall } = useActiveCall();

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

  return (
    <>
      {/* Main video area */}
      <div className="relative flex-1 overflow-hidden bg-muted">
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

  // Drag state
  const [position, setPosition] = useState({
    x: window.innerWidth - PIP_WIDTH - MARGIN,
    y: window.innerHeight - PIP_HEIGHT - MARGIN,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

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
    const x = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - PIP_WIDTH));
    const y = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - PIP_HEIGHT));
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
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
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
