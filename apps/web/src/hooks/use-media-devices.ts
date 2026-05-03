import { useCallback, useEffect, useRef, useState } from "react";

interface MediaDeviceLists {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceLists>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: [],
  });
  const [permissionGranted, setPermissionGranted] = useState(false);
  const mountedRef = useRef(true);

  const enumerate = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      const hasLabels = all.some((d) => d.label !== "");
      setPermissionGranted(hasLabels);
      setDevices({
        audioInputs: all.filter((d) => d.kind === "audioinput"),
        videoInputs: all.filter((d) => d.kind === "videoinput"),
        audioOutputs: all.filter((d) => d.kind === "audiooutput"),
      });
    } catch {
      // enumerateDevices not supported or blocked
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const handler = () => void enumerate();
    // Initial enumeration + listen for device changes
    handler();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [enumerate]);

  return { ...devices, permissionGranted, refresh: enumerate };
}
