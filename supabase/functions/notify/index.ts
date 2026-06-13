// Notify edge function — stuurt een neutrale push naar de andere leden van een gesprek.
// HARDE EISEN:
//  - Input is uitsluitend { conversation_id }. Berichtinhoud kan technisch niet meegegeven worden.
//  - Caller moet geauthenticeerd zijn en lid van de conversation.
//  - Payload bevat alleen { title } (bij groep met groepsnaam). Nooit afzender, tekst of ciphertext.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Client met JWT van caller (voor identity-check)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    // Input — alleen conversation_id wordt geaccepteerd
    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    const conversation_id = (body as { conversation_id?: unknown })?.conversation_id;
    if (typeof conversation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(conversation_id)) {
      return json({ error: "Invalid conversation_id" }, 400);
    }

    // Service-client voor membership + lookups (RLS bypass nodig om andermans subs te lezen).
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verifieer dat caller lid is
    const { data: callerMember } = await admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversation_id)
      .eq("user_id", callerId)
      .maybeSingle();
    if (!callerMember) return json({ error: "Forbidden" }, 403);

    // Andere leden + conversation type/naam
    const { data: conv } = await admin
      .from("conversations")
      .select("type, name")
      .eq("id", conversation_id)
      .maybeSingle();

    const { data: others } = await admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversation_id)
      .neq("user_id", callerId);
    const otherIds = (others ?? []).map((m) => m.user_id);
    if (otherIds.length === 0) return json({ ok: true, sent: 0 });

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, subscription")
      .in("user_id", otherIds);

    // Neutrale payload — server kan letterlijk geen inhoud meesturen.
    const title = conv?.type === "group" && conv?.name
      ? `Nieuw bericht in ${String(conv.name).slice(0, 80)}`
      : "Nieuw bericht";
    const payload = JSON.stringify({
      title,
      body: "Open de app om te lezen",
      url: `/chat/${conversation_id}`,
    });

    let sent = 0;
    const toDelete: string[] = [];
    await Promise.all((subs ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription as any, payload);
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) toDelete.push(row.id);
        else console.error("push failed", code, err?.body);
      }
    }));
    if (toDelete.length) {
      await admin.from("push_subscriptions").delete().in("id", toDelete);
    }
    return json({ ok: true, sent, cleaned: toDelete.length });
  } catch (e: any) {
    console.error(e);
    return json({ error: "Internal error" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
