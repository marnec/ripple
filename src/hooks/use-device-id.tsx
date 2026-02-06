import { useMemo } from "react";

const generateDeviceId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

export const useDeviceId = () => {
  const deviceId = useMemo(() => {
    if (typeof window !== "undefined") {
      const existing = sessionStorage.getItem("device_id");
      if (existing) return existing;
      const newId = generateDeviceId();
      sessionStorage.setItem("device_id", newId);
      return newId;
    }
    return "";
  }, []);

  return deviceId;
};
