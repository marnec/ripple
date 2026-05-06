import { ArrowLeft, LogOut, Maximize2, PhoneOff } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useActiveCall } from "@/contexts/ActiveCallContext";
import type { CallSourcePort } from "@/lib/call/source-port";

import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

/**
 * Rendered by a call surface when the user navigates to its route while
 * already in a different call. The active session keeps running (the
 * floating PiP stays visible) — this screen explains the situation and
 * gives the user three explicit choices instead of breaking the UI by
 * trying to render two calls at once.
 */
export function CallBusyScreen({
  requestedSource,
}: {
  requestedSource: CallSourcePort;
}) {
  const callCtx = useActiveCall();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Read the active descriptor — guaranteed non-null because the surface
  // only renders this screen when it detected a different active call.
  const active = callCtx.descriptor;
  if (!active) return null;

  const activeKindLabel =
    active.kind === "channel" ? "channel call" : "event call";

  // Switch is only safe from a settled phase. From `joining` / `leaving`
  // the user must wait — the buttons reflect that.
  const canSwitch = callCtx.status === "joined";

  const handleReturn = () => {
    callCtx.returnToCall();
  };

  const handleSwitch = async () => {
    if (busy || !canSwitch) return;
    setBusy(true);
    try {
      await callCtx.switchCall(requestedSource);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    void navigate(requestedSource.descriptor.leaveDestination);
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneOff className="h-4 w-4 text-destructive" />
            You&apos;re already in a call
          </CardTitle>
          <CardDescription>
            You&apos;re currently in {/* prettier: keep the article aligned */}
            {active.kind === "event" ? "an " : "a "}
            {activeKindLabel}. Leave it first to join this one, or return to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button onClick={handleReturn} className="gap-2">
            <Maximize2 className="h-4 w-4" />
            Return to current call
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleSwitch()}
            disabled={!canSwitch || busy}
            className="gap-2"
            title={
              canSwitch
                ? undefined
                : "Wait for the current call to finish connecting or leaving."
            }
          >
            <LogOut className="h-4 w-4" />
            Leave that and join this
          </Button>
          <Button variant="ghost" onClick={handleCancel} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
