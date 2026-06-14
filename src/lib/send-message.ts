// Centraal verzendpad. Encrypt het envelope per ontvanger en schrijf één rij per lid.
// Gebruikt voor: gewoon verzenden, doorsturen, locatie delen, document delen.

import { supabase } from "@/integrations/supabase/client";
import { encryptMessage } from "@/lib/crypto";
import { encodeEnvelope, type EnvelopeV1 } from "@/lib/message-envelope";
import { notifyConversation } from "@/lib/push";

type DbMessageType = "text" | "image" | "file" | "location";

export type MemberKey = { user_id: string; public_key: string | null; display_name?: string };

export async function sendEnvelopeToConversation(opts: {
  conversationId: string;
  senderId: string;
  senderPrivateKey: string;
  members: MemberKey[]; // alle leden inclusief sender zelf
  dbType: DbMessageType;
  envelope: EnvelopeV1;
  attachmentPath?: string | null;
  replyToMessageId?: string | null;
}): Promise<void> {
  const created_at = new Date().toISOString();
  const group_id = (globalThis.crypto ?? crypto).randomUUID();
  const plaintext = encodeEnvelope(opts.envelope);
  const rows: Array<{
    conversation_id: string;
    sender_id: string;
    recipient_id: string;
    ciphertext: string;
    nonce: string;
    type: DbMessageType;
    attachment_path: string | null;
    created_at: string;
    reply_to_message_id: string | null;
    group_id: string;
  }> = [];
  for (const m of opts.members) {
    if (!m.public_key) continue;
    const enc = await encryptMessage(plaintext, m.public_key, opts.senderPrivateKey);
    rows.push({
      conversation_id: opts.conversationId,
      sender_id: opts.senderId,
      recipient_id: m.user_id,
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      type: opts.dbType,
      attachment_path: opts.attachmentPath ?? null,
      created_at,
      reply_to_message_id: opts.replyToMessageId ?? null,
      group_id,
    });
  }

  if (rows.length === 0) return;
  const { error } = await supabase.from("messages").insert(rows);
  if (error) throw error;
  await supabase.from("conversations").update({ updated_at: created_at }).eq("id", opts.conversationId);
  void notifyConversation(opts.conversationId);
}

// Haal de leden (incl. publieke sleutels) op van een gesprek.
export async function loadConversationMembers(conversationId: string): Promise<MemberKey[]> {
  const { data: ms } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId);
  const ids = (ms ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name, public_key")
    .in("id", ids);
  return (profs ?? []).map((p) => ({
    user_id: p.id,
    display_name: p.display_name,
    public_key: p.public_key,
  }));
}
