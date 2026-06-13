import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertIsContact(ownerId: string, contactIds: string[]) {
  if (contactIds.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("contact_user_id")
    .eq("owner_id", ownerId)
    .in("contact_user_id", contactIds);
  if (error) throw error;
  const ok = new Set((data ?? []).map((r) => r.contact_user_id));
  for (const id of contactIds) {
    if (!ok.has(id)) throw new Error("Eén of meer deelnemers staan niet in je contacten.");
  }
}

export const createDirectConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { other_user_id: string }) => {
    if (!UUID_RE.test(data.other_user_id ?? "")) throw new Error("Ongeldig contact id");
    return data;
  })
  .handler(async ({ data, context }) => {
    if (data.other_user_id === context.userId) {
      throw new Error("Je kunt geen gesprek met jezelf starten.");
    }
    await assertIsContact(context.userId, [data.other_user_id]);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check public_key of other user
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("public_key")
      .eq("id", data.other_user_id)
      .maybeSingle();
    if (!prof?.public_key) {
      throw new Error("Dit contact heeft nog geen sleutel.");
    }

    // Re-use existing direct conversation if present
    const { data: mine } = await supabaseAdmin
      .from("conversation_members")
      .select("conversation_id, conversations!inner(type)")
      .eq("user_id", context.userId);
    const myDirectIds = (mine ?? [])
      .filter((m: { conversations?: { type?: string } }) => m.conversations?.type === "direct")
      .map((m) => m.conversation_id);
    if (myDirectIds.length) {
      const { data: theirs } = await supabaseAdmin
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", data.other_user_id)
        .in("conversation_id", myDirectIds);
      if (theirs && theirs.length) {
        return { id: theirs[0].conversation_id as string, existed: true as const };
      }
    }

    const { data: conv, error } = await supabaseAdmin
      .from("conversations")
      .insert({ type: "direct", created_by: context.userId })
      .select("id")
      .single();
    if (error || !conv) throw error ?? new Error("Kon gesprek niet aanmaken");

    const { error: memErr } = await supabaseAdmin.from("conversation_members").insert([
      { conversation_id: conv.id, user_id: context.userId },
      { conversation_id: conv.id, user_id: data.other_user_id },
    ]);
    if (memErr) throw memErr;

    return { id: conv.id as string, existed: false as const };
  });

export const createGroupConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; member_ids: string[] }) => {
    const name = (data.name ?? "").trim();
    if (name.length < 1 || name.length > 80) throw new Error("Naam moet 1–80 tekens zijn");
    const ids = Array.from(new Set(data.member_ids ?? []));
    if (ids.length < 1 || ids.length > 50) throw new Error("Kies 1–50 deelnemers");
    for (const id of ids) {
      if (!UUID_RE.test(id)) throw new Error("Ongeldig deelnemer-id");
    }
    return { name, member_ids: ids };
  })
  .handler(async ({ data, context }) => {
    const others = data.member_ids.filter((id) => id !== context.userId);
    if (others.length === 0) throw new Error("Kies minstens één andere deelnemer");
    await assertIsContact(context.userId, others);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conv, error } = await supabaseAdmin
      .from("conversations")
      .insert({ type: "group", name: data.name, created_by: context.userId })
      .select("id")
      .single();
    if (error || !conv) throw error ?? new Error("Kon groep niet aanmaken");

    const rows = [
      { conversation_id: conv.id, user_id: context.userId },
      ...others.map((uid) => ({ conversation_id: conv.id, user_id: uid })),
    ];
    const { error: memErr } = await supabaseAdmin.from("conversation_members").insert(rows);
    if (memErr) throw memErr;

    return { id: conv.id as string };
  });
