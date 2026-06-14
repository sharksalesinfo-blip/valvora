import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RECOVERY_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

function validateBlob(input: unknown): {
  recovery_id: string;
  ciphertext: string;
  nonce: string;
  kdf_salt: string;
  kdf_opslimit: number;
  kdf_memlimit: number;
} {
  if (!input || typeof input !== "object") throw new Error("Ongeldige invoer");
  const i = input as Record<string, unknown>;
  const recovery_id = String(i.recovery_id ?? "");
  if (!RECOVERY_ID_RE.test(recovery_id)) throw new Error("Ongeldige recovery_id");
  const ciphertext = String(i.ciphertext ?? "");
  const nonce = String(i.nonce ?? "");
  const kdf_salt = String(i.kdf_salt ?? "");
  if (ciphertext.length < 16 || ciphertext.length > 8192) throw new Error("Ciphertext-lengte ongeldig");
  if (nonce.length < 8 || nonce.length > 128) throw new Error("Nonce-lengte ongeldig");
  if (kdf_salt.length < 8 || kdf_salt.length > 128) throw new Error("Salt-lengte ongeldig");
  const kdf_opslimit = Number(i.kdf_opslimit);
  const kdf_memlimit = Number(i.kdf_memlimit);
  if (!Number.isFinite(kdf_opslimit) || kdf_opslimit < 1 || kdf_opslimit > 16) throw new Error("opslimit ongeldig");
  if (!Number.isFinite(kdf_memlimit) || kdf_memlimit < 1024 * 1024 || kdf_memlimit > 1024 * 1024 * 1024)
    throw new Error("memlimit ongeldig");
  return { recovery_id, ciphertext, nonce, kdf_salt, kdf_opslimit, kdf_memlimit };
}

/** Whether the current user has a recovery row. */
export const getMyRecoveryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("key_recovery")
      .select("recovery_id, updated_at")
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return { enabled: Boolean(data), updated_at: data?.updated_at ?? null };
  });

/** Create or replace the current user's recovery blob. */
export const saveMyRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => validateBlob(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("key_recovery")
      .upsert(
        {
          owner_id: context.userId,
          recovery_id: data.recovery_id,
          ciphertext: data.ciphertext,
          nonce: data.nonce,
          kdf_salt: data.kdf_salt,
          kdf_opslimit: data.kdf_opslimit,
          kdf_memlimit: data.kdf_memlimit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
    if (error) throw error;
    return { ok: true };
  });


export const disableMyRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("key_recovery")
      .delete()
      .eq("owner_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * PUBLIC (no auth). Lookup by recovery_id. Returns the encrypted blob or a
 * generic "not found". The recovery_id is high-entropy and the blob is
 * opaque without the secret part of the code.
 */
export const fetchRecoveryByLookup = createServerFn({ method: "POST" })
  .inputValidator((data: { recovery_id: string }) => {
    const id = String(data?.recovery_id ?? "");
    if (!RECOVERY_ID_RE.test(id)) throw new Error("Ongeldige herstelcode");
    return { recovery_id: id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("key_recovery")
      .select("ciphertext, nonce, kdf_salt, kdf_opslimit, kdf_memlimit")
      .eq("recovery_id", data.recovery_id)
      .maybeSingle();
    if (!row) return { found: false as const };
    return { found: true as const, blob: row };
  });
