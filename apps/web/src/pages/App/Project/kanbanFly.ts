import { createContext, useContext } from "react";

/** Cards register/unregister their outer DOM node so the board can measure
 *  their on-screen rect for cross-column "flying card" animations. */
export type RegisterCardNode = (taskId: string, el: HTMLElement | null) => void;

const KanbanFlyContext = createContext<RegisterCardNode>(() => {});

export const KanbanFlyProvider = KanbanFlyContext.Provider;

export function useRegisterCardNode(): RegisterCardNode {
  return useContext(KanbanFlyContext);
}
