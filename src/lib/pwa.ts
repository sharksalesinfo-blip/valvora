// Registreer de push-service worker, alleen op echte builds (geen Lovable preview).
const PREVIEW_HOSTS = [
  "lovableproject.com",
  "lovableproject-dev.com",
  "beta.lovable.dev",
];
function isPreviewHost(): boolean {
  if (typeof window === "undefined") return true;
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  return PREVIEW_HOSTS.some((d) => h === d || h.endsWith("." + d));
}

export async function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  if (window !== window.top) return null;
  if (isPreviewHost()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}
