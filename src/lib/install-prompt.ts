// Vangt het `beforeinstallprompt`-event zo vroeg mogelijk op zodat we het later
// kunnen aanbieden vanuit onze eigen UI. Browsers vuren het maar één keer per
// sessie af, dus dit moet bij module-load (vóór onze React-tree) gebeuren.

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BIPEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export function getDeferredInstall(): BIPEvent | null {
  return deferred;
}

export function isAppInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (installed) return true;
  // Display-mode standalone of iOS-style navigator.standalone
  const mql = window.matchMedia?.("(display-mode: standalone)");
  if (mql?.matches) return true;
  if ((navigator as unknown as { standalone?: boolean }).standalone) return true;
  return false;
}

export function subscribeInstallChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  try {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    emit();
    return choice.outcome;
  } catch {
    return "dismissed";
  }
}

export function detectIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1);
  if (!isIOS) return false;
  // Safari (niet Chrome/Firefox/Edge op iOS — die werken alleen via Safari-engine
  // maar tonen "Zet op beginscherm" toch alleen in Safari zelf).
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isSafari;
}

// --- Dismiss-cooldown (lokaal) ---
const KEY = "install-prompt-dismissed-at";
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 dagen

export function markInstallDismissed() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch {}
}
export function installDismissedRecently(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return false;
    return Date.now() - Number(v) < COOLDOWN_MS;
  } catch {
    return false;
  }
}
