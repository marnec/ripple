// Push Event - Display Push Notification
self.addEventListener('push', (event) => {
  
  const data = event.data ? JSON.parse(event.data.text()) : { title: 'Default Title', body: 'Default Body' };

  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});