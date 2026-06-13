import { supabase } from "@/integrations/supabase/client";
import { generateKeyPair, publicKeyFingerprint } from "./crypto";
import { loadPrivateKey, savePrivateKey } from "./local-key-store";

// Zorgt dat de huidige gebruiker een sleutelpaar heeft.
// - publieke sleutel + fingerprint staan in profiles
// - private sleutel staat alleen in IndexedDB op dit apparaat
export async function ensureKeyPair(userId: string): Promise<{ privateKey: string; publicKey: string }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("public_key")
    .eq("id", userId)
    .maybeSingle();

  let priv = await loadPrivateKey(userId);

  if (profile?.public_key && priv) {
    return { privateKey: priv, publicKey: profile.public_key };
  }

  // Geen sleutel op dit apparaat OF geen publieke sleutel op de server → nieuw paar
  const kp = await generateKeyPair();
  await savePrivateKey(userId, kp.privateKey);
  const fingerprint = await publicKeyFingerprint(kp.publicKey);
  await supabase
    .from("profiles")
    .update({ public_key: kp.publicKey, key_fingerprint: fingerprint })
    .eq("id", userId);
  return { privateKey: kp.privateKey, publicKey: kp.publicKey };
}
