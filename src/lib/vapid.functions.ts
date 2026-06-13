import { createServerFn } from "@tanstack/react-start";

// Publieke VAPID-key mag client-side bekend zijn (is per definitie public).
// Privé key wordt nooit via deze functie of via een andere route blootgesteld.
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) throw new Error("VAPID_PUBLIC_KEY not configured");
  return { publicKey: key };
});
