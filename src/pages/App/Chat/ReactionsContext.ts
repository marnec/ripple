import { createContext, useContext } from "react";

type Reaction = {
  emoji: string;
  emojiNative: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
};

/** Map of messageId → grouped reactions, provided by Chat.tsx via a single batched query. */
type ReactionsMap = Record<string, Reaction[]>;

export const ReactionsContext = createContext<ReactionsMap | undefined>(
  undefined,
);

export function useReactions(messageId: string): Reaction[] | undefined {
  const map = useContext(ReactionsContext);
  if (!map) return undefined;
  return map[messageId] ?? [];
}
