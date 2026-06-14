// Registreer de push-service worker. Deze worker cached niets; hij toont alleen
// pushmeldingen, dus hij mag ook in preview/dev-contexten geregistreerd worden.
export async function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}
