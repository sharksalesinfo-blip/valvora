import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeHandle(raw: string) {
  return raw.replace(/^@/, "").trim();
}

/** Insert two-sided contact rows. Idempotent. */
async function insertMutualContacts(
  a: string,
  b: string,
): Promise<void> {
  if (a === b) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("contacts")
    .upsert(
      [
        { owner_id: a, contact_user_id: b },
        { owner_id: b, contact_user_id: a },
      ],
      { onConflict: "owner_id,contact_user_id" },
    );
}

export const getMyInvite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_invites")
      .select("token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return { token: data.token as string };
    // Fallback: create one if somehow missing
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error: insErr } = await supabaseAdmin
      .from("user_invites")
      .insert({ user_id: context.userId })
      .select("token")
      .single();
    if (insErr) throw insErr;
    return { token: created.token as string };
  });

export const rotateInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_invites")
      .upsert(
        { user_id: context.userId, token: crypto.randomUUID(), updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      )
      .select("token")
      .single();
    if (error) throw error;
    return { token: data.token as string };
  });

export const setHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { handle: string }) => {
    const h = normalizeHandle(data.handle ?? "");
    if (!HANDLE_RE.test(h)) {
      throw new Error("Gebruik 3-20 tekens: letters, cijfers of _");
    }
    return { handle: h };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ handle: data.handle })
      .eq("id", context.userId);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("Deze handle is al in gebruik");
      }
      throw error;
    }
    return { handle: data.handle };
  });

export const lookupInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { token: string }) => {
    if (!UUID_RE.test(data.token ?? "")) throw new Error("Ongeldige uitnodigingscode");
    return { token: data.token };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("user_invites")
      .select("user_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { found: false as const };
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, handle")
      .eq("id", row.user_id)
      .maybeSingle();
    if (!prof) return { found: false as const };
    return { found: true as const, user_id: prof.id, display_name: prof.display_name, handle: prof.handle };
  });

export const joinByInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { token: string }) => {
    if (!UUID_RE.test(data.token ?? "")) throw new Error("Ongeldige uitnodigingscode");
    return { token: data.token };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("user_invites")
      .select("user_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) throw new Error("Deze invite-link werkt niet meer.");
    if (row.user_id === context.userId) {
      return { ok: true, contact_user_id: context.userId, self: true as const };
    }
    await insertMutualContacts(context.userId, row.user_id);
    return { ok: true, contact_user_id: row.user_id, self: false as const };
  });

export const findByHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { handle: string }) => {
    const h = normalizeHandle(data.handle ?? "");
    if (!HANDLE_RE.test(h)) throw new Error("Ongeldige handle");
    return { handle: h };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, handle, public_key")
      .ilike("handle", data.handle)
      .maybeSingle();
    if (!prof) return { found: false as const };
    return {
      found: true as const,
      user_id: prof.id,
      display_name: prof.display_name,
      handle: prof.handle,
      has_key: Boolean(prof.public_key),
    };
  });

export const addByHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { handle: string }) => {
    const h = normalizeHandle(data.handle ?? "");
    if (!HANDLE_RE.test(h)) throw new Error("Ongeldige handle");
    return { handle: h };
  })
  .handler(async ({ data, context }) => {
    // Uniforme respons: een buitenstaander kan uit { ok: true, added: false }
    // niet afleiden of de handle bestaat of niet — beide paden hebben dezelfde
    // responsvorm en geven geen fout terug. De UI toont in beide gevallen een
    // neutrale "Geen resultaat" boodschap als added=false.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .ilike("handle", data.handle)
      .maybeSingle();
    if (!prof) {
      return { ok: true as const, added: false as const, self: false as const, contact_user_id: null, display_name: null };
    }
    if (prof.id === context.userId) {
      return { ok: true as const, added: false as const, self: true as const, contact_user_id: prof.id, display_name: prof.display_name };
    }
    await insertMutualContacts(context.userId, prof.id);
    return { ok: true as const, added: true as const, self: false as const, contact_user_id: prof.id, display_name: prof.display_name };
  });

/**
 * Add a contact after the caller has *locally* verified the public key via QR.
 * The server re-checks that the stored public key equals what was scanned,
 * but never decides whether the scan matched — that's done client-side.
 */
export const addVerifiedContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { contact_user_id: string; public_key: string }) => {
    if (!UUID_RE.test(data.contact_user_id ?? "")) throw new Error("Ongeldig contact id");
    if (typeof data.public_key !== "string" || data.public_key.length < 16 || data.public_key.length > 512) {
      throw new Error("Ongeldige publieke sleutel");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    if (data.contact_user_id === context.userId) {
      return { ok: true, self: true as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("public_key")
      .eq("id", data.contact_user_id)
      .maybeSingle();
    if (!prof || prof.public_key !== data.public_key) {
      throw new Error("De sleutel van dit contact komt niet (meer) overeen met de server.");
    }
    await insertMutualContacts(context.userId, data.contact_user_id);
    return { ok: true, self: false as const };
  });

/** Minimal public profile lookup by user id (for QR verification fallback). */
export const lookupProfileById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) => {
    if (!UUID_RE.test(data.user_id ?? "")) throw new Error("Ongeldig user id");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, public_key")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!prof) return { found: false as const };
    return {
      found: true as const,
      user_id: prof.id,
      display_name: prof.display_name,
      public_key: prof.public_key,
    };
  });
