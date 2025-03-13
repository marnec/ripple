window.addEventListener("load", () => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.register("/service-worker.js").catch((error) => {
        console.error("An error occurred while registering the service worker.");
        console.error(error);
      });
    } else {
      console.error("Browser does not support service workers or push messages.");
    }
  });