import React, { useContext } from "react";
import type { Doc } from "@convex/_generated/dataModel";

export const UserContext = React.createContext<Doc<"users"> | null | undefined>(null);

/** Return the viewer provided by App.tsx — avoids a duplicate useQuery(api.users.viewer) per page. */
export function useViewer() {
  return useContext(UserContext);
}
