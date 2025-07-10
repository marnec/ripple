import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useDeviceId } from "./use-device-id";
import { ConvexError } from "convex/values";

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

export const usePushNotifications = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [permission, setPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied",
  );
  const registerSubscription = useMutation(api.pushSubscription.registerSubscription);
  const unregisterSubscription = useMutation(api.pushSubscription.unregisterSubscription);
  const deviceId = useDeviceId();

  const subscribeUser = async () => {
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
  };

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

  const getSubscription = async (): Promise<PushSubscription | null> => {
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
  };

  const createSubscription = async (): Promise<PushSubscription> => {
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
  };

  return { isSubscribed, permission, error, getSubscription, subscribeUser, unsubscribeUser };
};

export default usePushNotifications;
