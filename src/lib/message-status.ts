// Aflever- en leesstatus per bericht. Pure metadata (welk bericht-groep, welke
// ontvanger, welk tijdstip) — geen inhoud. RLS zorgt dat alleen leden van het
// gesprek statusrijen kunnen lezen en dat een gebruiker alleen voor zichzelf
// een status mag schrijven, en alleen voor berichten waar hij ontvanger van was.

import { supabase } from "@/integrations/supabase/client";

export type StatusKind = "delivered" | "read";

export type StatusRow = {
  group_id: string;
  user_id: string;
  status: StatusKind;
  at: string;
};

// Best-effort schrijven; bij duplicaten retourneert PostgREST een conflict
// (PK is (group_id, user_id, status)) — dat is OK, status is append-only.
export async function writeStatus(opts: {
  groupId: string;
  conversationId: string;
  userId: string;
  status: StatusKind;
}): Promise<void> {
  await supabase
    .from("message_status")
    .insert(
      {
        group_id: opts.groupId,
        conversation_id: opts.conversationId,
        user_id: opts.userId,
        status: opts.status,
      },
      { count: "exact" } as never,
    )
    .then(() => undefined, () => undefined);
}

// Verstuurd → één vinkje. Afgeleverd → twee vinkjes. Gelezen → blauwe vinkjes.
// In groepen: alleen "afgeleverd"/"gelezen" tonen als ALLE andere leden die
// status hebben bereikt (v1 — geen per-lid-matrix).
export function aggregateStatus(opts: {
  rowsForGroup: StatusRow[];
  otherMemberCount: number;
  showRead: boolean; // false = leesbevestigingen lokaal uit (wederkerig)
  selfUserId?: string; // sluit de afzender uit van de telling
}): "sent" | "delivered" | "read" {
  if (opts.otherMemberCount <= 0) return "sent";
  const delivered = new Set<string>();
  const read = new Set<string>();
  for (const r of opts.rowsForGroup) {
    if (opts.selfUserId && r.user_id === opts.selfUserId) continue;
    if (r.status === "delivered") delivered.add(r.user_id);
    if (r.status === "read") {
      read.add(r.user_id);
      delivered.add(r.user_id); // "read" impliceert "delivered"
    }
  }
  if (opts.showRead && read.size >= opts.otherMemberCount) return "read";
  if (delivered.size >= opts.otherMemberCount) return "delivered";
  return "sent";
}
