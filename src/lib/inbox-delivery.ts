// Globale aflever-tracker. Schrijft `delivered` zodra een bericht voor deze
// gebruiker aankomt — ongeacht op welk scherm hij staat. Dekt ook het geval
// dat de tab gebackgrounded was (WebSocket sliep): bij visibility=visible
// of focus draaien we een lichte inhaalslag op recente berichten.
//
// Pure metadata — raakt geen inhoud, geen sleutels, geen RLS.

import { supabase } from "@/integrations/supabase/client";
import { writeStatus } from "@/lib/message-status";

const CATCHUP_LIMIT = 100;

export async function catchUpDelivered(userId: string, limit = CATCHUP_LIMIT): Promise<void> {
  const { data } = await supabase
    .from("messages")
    .select("group_id, conversation_id, sender_id, recipient_id")
    .eq("recipient_id", userId)
    .neq("sender_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  for (const m of data ?? []) {
    // writeStatus is idempotent (insert; PK-conflict wordt stil geslikt).
    void writeStatus({
      groupId: m.group_id,
      conversationId: m.conversation_id,
      userId,
      status: "delivered",
    });
  }
}

export function installInboxDeliveryTracker(userId: string): () => void {
  // 1) Inhaalslag bij mount — dekt openen-vanuit-koud en gemiste berichten.
  void catchUpDelivered(userId);

  // 2) Realtime-kanaal: schrijf `delivered` voor elk nieuw bericht waarvan
  //    deze gebruiker ontvanger is. Idempotent t.o.v. het `chat:${convId}`-
  //    kanaal in het chatscherm — duplicate inserts conflicteren op de PK
  //    (group_id, user_id, status) en worden door writeStatus genegeerd.
  const ch = supabase
    .channel(`inbox:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => {
        const m = payload.new as {
          group_id: string;
          conversation_id: string;
          sender_id: string;
        };
        if (m.sender_id === userId) return; // niet je eigen kopie
        void writeStatus({
          groupId: m.group_id,
          conversationId: m.conversation_id,
          userId,
          status: "delivered",
        });
      },
    )
    .subscribe();

  // 3) Resume-inhaalslag: bij visibility=visible of focus opnieuw query'en.
  //    Vooral relevant op iOS Safari, waar de WS in de achtergrond pauzeert.
  const onResume = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      void catchUpDelivered(userId);
    }
  };
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("focus", onResume);

  return () => {
    void supabase.removeChannel(ch);
    document.removeEventListener("visibilitychange", onResume);
    window.removeEventListener("focus", onResume);
  };
}
