import { supabase } from "@/integrations/supabase/client";
import { getVapidPublicKey } from "@/lib/vapid.functions";
import { registerPushWorker } from "@/lib/pwa";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getPushStatus(): Promise<"unsupported" | "denied" | "granted" | "default"> {
  if (!pushSupported()) return "unsupported";
  return Notification.permission as "denied" | "granted" | "default";
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function subscribePush(userId: string): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = (await registerPushWorker()) ?? (await navigator.serviceWorker.getRegistration("/sw.js"));
  if (!reg) return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe().catch(() => {});
  const { publicKey } = await getVapidPublicKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      subscription: json as any,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error(error);
    return false;
  }
  return true;
}

export async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
}

const ASKED_KEY = "push-permission-asked";
export function hasAskedPushPermission(): boolean {
  try { return localStorage.getItem(ASKED_KEY) === "1"; } catch { return false; }
}
export function markPushPermissionAsked() {
  try { localStorage.setItem(ASKED_KEY, "1"); } catch {}
}

export async function notifyConversation(conversationId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify`;
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  } catch (e) {
    console.warn("notify failed", e);
  }
}
