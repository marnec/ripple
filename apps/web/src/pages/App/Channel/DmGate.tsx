import { MessagesSquare } from "lucide-react";

interface DmGateProps {
  participants: { userId: string; name: string }[];
}

export function DmGate({ participants }: DmGateProps) {
  const names = participants.map((p) => p.name);
  const label =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : names.join(", ");

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
          <MessagesSquare className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Direct Message</h2>
        <p className="text-sm text-muted-foreground">
          This is a private conversation between {label}. Only the participants can read its messages.
        </p>
      </div>
    </div>
  );
}
