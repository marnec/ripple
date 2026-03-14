import { createContext, useContext } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const UPDATE_CHECK_INTERVAL_MS = 60 * 1000; // Check every 60s

interface PwaUpdateState {
  needRefresh: boolean;
  updateAndReload: () => void;
  checkForUpdate: () => Promise<void>;
}

const PwaUpdateContext = createContext<PwaUpdateState>({
  needRefresh: false,
  updateAndReload: () => {},
  checkForUpdate: async () => {},
});

export function PwaUpdateProvider({ children }: { children: React.ReactNode }) {
  const registrationRef = { current: null as ServiceWorkerRegistration | null };

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      registrationRef.current = registration;
      setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  const updateAndReload = () => {
    void updateServiceWorker(true).then(() => {
      // Fallback: if the plugin's reload didn't fire, force it
      setTimeout(() => {
        window.location.reload();
      }, 500);
    });
  };

  const checkForUpdate = async () => {
    if (registrationRef.current) {
      await registrationRef.current.update();
    }
  };

  return (
    <PwaUpdateContext.Provider value={{ needRefresh, updateAndReload, checkForUpdate }}>
      {children}
    </PwaUpdateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePwaUpdate() {
  return useContext(PwaUpdateContext);
}
