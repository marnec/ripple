import { useSyncExternalStore } from "react";

export interface UserSettings {
  notificationsEnabled: boolean;
  language: string;
}

const STORAGE_KEY = "ripple:user-settings";

const DEFAULT_SETTINGS: UserSettings = {
  notificationsEnabled: false,
  language: "en",
};

let cachedRaw: string | null = null;
let cachedSettings: UserSettings = DEFAULT_SETTINGS;

function getSnapshot(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedSettings;
    cachedRaw = raw;
    if (!raw) {
      cachedSettings = DEFAULT_SETTINGS;
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as UserSettings;
    }
    return cachedSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function getServerSnapshot(): UserSettings {
  return DEFAULT_SETTINGS;
}

let listeners: Array<() => void> = [];

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useUserSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const updateSettings = (patch: Partial<UserSettings>) => {
    const current = getSnapshot();
    const next = { ...current, ...patch };
    const raw = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedSettings = next;
    emitChange();
  };

  return [settings, updateSettings] as const;
}
