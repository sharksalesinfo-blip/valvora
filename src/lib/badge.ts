// Best-effort app-icon-badge (Badging API).
// - Niet ondersteund? Stille no-op (geen errors).
// - Tellers worden client-side bijgehouden: SW telt push-events op, foreground
//   resets bij visibilitychange of bij het openen van een chat.
// - Exact aantal kan afwijken: bewuste afweging tegen metadata-lekkage in de
//   push-payload. Op iOS kan de badge afwezig blijven; dat is acceptabel.

type Nav = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function badgeSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as Nav).setAppBadge === "function";
}

export async function clearAppBadge(): Promise<void> {
  const n = navigator as Nav;
  try { await n.clearAppBadge?.(); } catch {}
  // Vraag de SW ook de lokale teller te resetten zodat een nieuwe push weer
  // bij 1 begint.
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/sw.js");
    reg?.active?.postMessage({ type: "BADGE_RESET" });
  } catch {}
}

/** Reset badge zodra de app naar voorgrond komt of bij het openen van een chat. */
export function installBadgeResetOnForeground() {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") void clearAppBadge();
  };
  document.addEventListener("visibilitychange", handler);
  // Direct ook resetten als we nu al zichtbaar zijn.
  if (document.visibilityState === "visible") void clearAppBadge();
  return () => document.removeEventListener("visibilitychange", handler);
}
