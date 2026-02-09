/* eslint-disable react-refresh/only-export-components */
import { MicOff } from "lucide-react";
import { cn } from "../../../lib/utils";

function Root({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Video({
  videoRef,
  mirrored,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mirrored?: boolean;
}) {
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={cn("h-full w-full object-cover", mirrored && "-scale-x-100")}
    />
  );
}

function AvatarFallback({ name }: { name: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
        {name?.charAt(0).toUpperCase() || "?"}
      </div>
      <span className="text-sm text-muted-foreground">
        {name || "Participant"}
      </span>
    </div>
  );
}

function NameBadge({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs text-white">
      {muted && <MicOff className="h-3 w-3" />}
      <span>{name || "Participant"}</span>
    </div>
  );
}

export const VideoTile = { Root, Video, AvatarFallback, NameBadge };
