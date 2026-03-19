import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";

const VERSION_KEY = "ripple:known-version";

function getKnownVersion(): number | null {
  const v = localStorage.getItem(VERSION_KEY);
  return v ? Number(v) : null;
}

export function acknowledgeVersion(version: number) {
  localStorage.setItem(VERSION_KEY, String(version));
}

export function useVersionCheck(): { hasUpdate: boolean; acknowledge: () => void } {
  const liveVersion = useQuery(api.version.get);

  // Seed localStorage on first resolution so we have a baseline to compare against.
  useEffect(() => {
    if (liveVersion == null) return;
    if (getKnownVersion() === null) {
      acknowledgeVersion(liveVersion);
    }
  }, [liveVersion]);

  const knownVersion = getKnownVersion();
  const hasUpdate =
    liveVersion != null &&
    knownVersion !== null &&
    liveVersion !== knownVersion;

  const acknowledge = () => {
    if (liveVersion != null) acknowledgeVersion(liveVersion);
  };

  return { hasUpdate, acknowledge };
}
