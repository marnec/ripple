import { useState, useEffect } from "react";

const generateDeviceId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

export const useDeviceId = () => {
  const [deviceId, setDeviceId] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("device_id") || "";
    }
    return "";
  });

  useEffect(() => {
    if (!deviceId) {
      const newId = generateDeviceId();
      setDeviceId(newId);
      sessionStorage.setItem("device_id", newId);
    }
  }, [deviceId]);

  return deviceId;
};
