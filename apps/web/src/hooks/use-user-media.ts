import { useEffect, useRef, useState } from "react";

interface UseUserMediaConfig {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

export function useUserMedia(config: UseUserMediaConfig) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Stop previous stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // If both disabled, nothing to acquire
    if (!config.audio && !config.video) {
      // Use queueMicrotask so setState isn't synchronous in effect body
      queueMicrotask(() => {
        if (!cancelled) {
          setStream(null);
          setError(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const acquire = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: config.audio
            ? config.audioDeviceId
              ? { deviceId: { exact: config.audioDeviceId } }
              : true
            : false,
          video: config.video
            ? config.videoDeviceId
              ? { deviceId: { exact: config.videoDeviceId } }
              : true
            : false,
        };

        const s = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to access media devices",
          );
          setStream(null);
        }
      }
    };

    void acquire();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [config.audio, config.video, config.audioDeviceId, config.videoDeviceId]);

  return { stream, error };
}
