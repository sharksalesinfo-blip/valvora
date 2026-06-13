import { supabase } from "@/integrations/supabase/client";

export type ContactVerification = {
  contact_user_id: string;
  public_key: string;
  verified_at: string;
};

export type QrPayload = {
  v: 1;
  uid: string;
  pk: string;
};

export function buildQrPayload(userId: string, publicKey: string): string {
  const payload: QrPayload = { v: 1, uid: userId, pk: publicKey };
  return JSON.stringify(payload);
}

export function parseQrPayload(raw: string): QrPayload | null {
  try {
    const p = JSON.parse(raw);
    if (
      p &&
      p.v === 1 &&
      typeof p.uid === "string" &&
      typeof p.pk === "string"
    ) {
      return p as QrPayload;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Fetch this user's verification entries for the listed contacts. */
export async function loadVerifications(
  ownerId: string,
  contactIds: string[],
): Promise<Map<string, ContactVerification>> {
  const map = new Map<string, ContactVerification>();
  if (contactIds.length === 0) return map;
  const { data } = await supabase
    .from("contact_verifications")
    .select("contact_user_id, public_key, verified_at")
    .eq("owner_id", ownerId)
    .in("contact_user_id", contactIds);
  for (const row of data ?? []) map.set(row.contact_user_id, row as ContactVerification);
  return map;
}

/**
 * Mark a contact as verified, after a LOCAL public-key match (camera scan).
 * The server is never asked to compare or confirm.
 */
export async function markVerified(
  ownerId: string,
  contactUserId: string,
  publicKey: string,
) {
  const { error } = await supabase
    .from("contact_verifications")
    .upsert(
      {
        owner_id: ownerId,
        contact_user_id: contactUserId,
        public_key: publicKey,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,contact_user_id" },
    );
  if (error) throw error;
}

/** Drop a verification (used when we detect a key change). */
export async function clearVerification(ownerId: string, contactUserId: string) {
  await supabase
    .from("contact_verifications")
    .delete()
    .eq("owner_id", ownerId)
    .eq("contact_user_id", contactUserId);
}

export type VerificationState =
  | { kind: "unverified" }
  | { kind: "verified"; verified_at: string }
  | { kind: "changed"; previousVerifiedAt: string };

/**
 * Compute verification state for a contact given the public key the server
 * currently reports. Drops + signals "changed" when the key differs from the
 * stored snapshot.
 */
export async function reconcileVerification(
  ownerId: string,
  contactUserId: string,
  currentPublicKey: string | null,
  cached?: ContactVerification,
): Promise<VerificationState> {
  if (!cached) return { kind: "unverified" };
  if (!currentPublicKey) return { kind: "unverified" };
  if (cached.public_key === currentPublicKey) {
    return { kind: "verified", verified_at: cached.verified_at };
  }
  // Key rotated: drop the verification, signal the change once.
  await clearVerification(ownerId, contactUserId);
  return { kind: "changed", previousVerifiedAt: cached.verified_at };
}
