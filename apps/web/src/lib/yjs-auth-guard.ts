import type YProvider from "y-partyserver/provider";

/**
 * Guard a YProvider against auth-failure reconnect storms.
 *
 * y-websocket resets its backoff counter on every successful WebSocket
 * upgrade (101). When auth fails AFTER the upgrade (server closes with
 * 1008), the provider reconnects in ~100ms with no backoff increase.
 *
 * Uses the `connection-close` event which fires INSIDE y-websocket's
 * close handler, BEFORE the reconnect setTimeout is scheduled. Setting
 * `shouldConnect = false` here guarantees the queued `setupWS` won't
 * create a new WebSocket.
 *
 * @param onAuthFailure Optional callback after the provider is stopped
 *   (e.g. to trigger recreation with a fresh token).
 */
export function guardAuthFailure(
  provider: YProvider,
  onAuthFailure?: () => void,
): void {
  let stopped = false;

  provider.on(
    "connection-close",
    (event: CloseEvent, _provider: YProvider) => {
      if (stopped) return;
      if (event.code === 1008) {
        stopped = true;
        provider.shouldConnect = false;
        provider.destroy();
        onAuthFailure?.();
      }
    },
  );
}
