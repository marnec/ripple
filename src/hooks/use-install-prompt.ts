import { useState, useEffect, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Capture the event at module level so it's not lost if it fires before React mounts
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) listener();
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  notifyListeners();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  notifyListeners();
});

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return deferredPrompt;
}

export function useInstallPrompt() {
  const prompt = useSyncExternalStore(subscribe, getSnapshot);
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(display-mode: standalone)");
    const handler = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const promptInstall = async () => {
    if (!prompt) return false;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;

    if (outcome === "accepted") {
      deferredPrompt = null;
      setIsInstalled(true);
      notifyListeners();
    }

    return outcome === "accepted";
  };

  return {
    canInstall: !!prompt && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
