import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { useDeviceId } from "./use-device-id";
import { ConvexError } from "convex/values";
import { useUserSettings } from "./use-user-settings";

interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime: EpochTimeStamp | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

const VAPID_PUBLIC_KEY =
  "BF1G1JORD5NfrUzNu29tz10cV8dYtuN7iTcrdKi2bFRQuub3EJrJy4ujzu9gGRaRG-wEFTm26kpJGmKAb9t7vZ8";

function urlB64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    throw new ConvexError("No service worker registration found.");
  }

  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    console.warn("No subscription found");
    return null;
  }

  return subscription;
}

async function createSubscription(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    throw new ConvexError("No service worker registration found.");
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  if (!subscription) {
    throw new ConvexError("Could not create a subscription");
  }

  return subscription;
}

async function doSubscribeUser(
  registerSubscription: (args: PushSubscriptionJSON & { device: string }) => Promise<unknown>,
  deviceId: string,
  setPermission: (p: NotificationPermission) => void,
  setIsSubscribed: (v: boolean) => void,
  setError: (e: unknown) => void,
) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) {
      throw new Error("Push notifications are not supported in this browser.");
    }
    const result = await Notification.requestPermission();
    setPermission(result);

    if (result === "denied") {
      console.error("The user explicitly denied the permission request.");
      return;
    }

    if (result === "granted") {
      console.info("The user accepted the permission request.");
    }

    let pushSubscription = await getSubscription();

    if (!pushSubscription) {
      pushSubscription = await createSubscription();
    }

    setIsSubscribed(true);

    const subscription = pushSubscription.toJSON();

    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new ConvexError("The pushManager subscription is malformed");
    }

    await registerSubscription({ ...(subscription as PushSubscriptionJSON), device: deviceId });
  } catch (err) {
    console.error("Failed to subscribe the user:", err);
    setError(err);
  }
}

export const usePushNotifications = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [permission, setPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied",
  );
  const registerSubscription = useMutation(api.pushSubscription.registerSubscription);
  const unregisterSubscription = useMutation(api.pushSubscription.unregisterSubscription);
  const deviceId = useDeviceId();

  const subscribeUser = () =>
    doSubscribeUser(
      registerSubscription,
      deviceId,
      setPermission,
      setIsSubscribed,
      setError,
    );

  const [settings, updateSettings] = useUserSettings();
  const syncedRef = useRef(false);

  // On app load: if browser permission is granted, ensure we have a valid
  // push subscription registered. Handles the case where site data was cleared
  // (localStorage + push subscription gone) but browser permission persists.
  useEffect(() => {
    if (syncedRef.current) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    syncedRef.current = true;

    // Re-enable the local setting if it was cleared with site data
    if (!settings.notificationsEnabled) {
      updateSettings({ notificationsEnabled: true });
    }

    // Re-register subscription (creates a new one if browser sub was cleared)
    void subscribeUser();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const unsubscribeUser = async () => {
    const subscription = await getSubscription();

    if (!subscription) {
      console.warn("No subscription found; considered unregisterd.");
      return;
    }

    const unsubscribed = await subscription.unsubscribe();

    if (unsubscribed) {
      console.info("Successfully unsubscribed from push notifications.");
    }

    await unregisterSubscription({ endpoint: subscription.endpoint });
  };

  return { isSubscribed, permission, error, getSubscription, subscribeUser, unsubscribeUser };
};

export default usePushNotifications;
