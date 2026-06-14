// TIJDELIJK: stuurt een testpush naar ALLE push_subscriptions. Verwijder na test.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, subscription");
  const payload = JSON.stringify({ title: "Testmelding", body: "Push werkt 🎉", url: "/" });
  const results: any[] = [];
  for (const row of subs ?? []) {
    try {
      await webpush.sendNotification(row.subscription as any, payload);
      results.push({ id: row.id, ok: true });
    } catch (e: any) {
      results.push({ id: row.id, ok: false, code: e?.statusCode, body: e?.body });
    }
  }
  return new Response(JSON.stringify({ count: subs?.length ?? 0, results }), {
    headers: { "content-type": "application/json" },
  });
});
