import { MessagesSquare } from "lucide-react";

interface DmGateProps {
  /**
   * The conversation's label, rendered by the server.
   *
   * This used to be the raw roster, joined here into `${a} and ${b}` — a
   * second, incompatible implementation of `lib/dmLabel.ts`'s renderer. It
   * joined with " and " where the canonical form uses " × ", handled no
   * overflow and no empty case, and — because it did not sort — showed the two
   * people in a conversation *different orderings of themselves* on the one
   * screen where both of them are looking at it from outside.
   */
  label: string;
}

export function DmGate({ label }: DmGateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
          <MessagesSquare className="w-6 h-6 text-muted-foreground" />
        </div>
        {/* The label is a name, so it goes where a name goes. Reading it out
            mid-sentence ("a conversation between Alice × Bob") is what pushed
            the old copy into inventing its own join word. */}
        <h2 className="text-lg font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground">
          You're not in this conversation. Only its participants can read the messages.
        </p>
      </div>
    </div>
  );
}
