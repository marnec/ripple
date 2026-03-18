import { useQuery } from "convex/react";
import { useRef } from "react";
import { api } from "../../convex/_generated/api";

export function useVersionCheck(): boolean {
  const currentVersion = useQuery(api.version.get);
  const initialVersion = useRef<number | null | undefined>(undefined);

  if (initialVersion.current === undefined && currentVersion !== undefined) {
    initialVersion.current = currentVersion;
  }

  return (
    initialVersion.current !== undefined &&
    currentVersion !== undefined &&
    currentVersion !== initialVersion.current
  );
}
