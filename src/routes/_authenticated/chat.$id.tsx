import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Send, Paperclip, ShieldCheck, ShieldAlert, ShieldQuestion, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, initials } from "@/lib/format";
import { toast } from "sonner";
import {
  decryptFile,
  decryptMessage,
  encryptFile,
  encryptMessage,
  sodiumReady,
} from "@/lib/crypto";
import { loadPrivateKey } from "@/lib/local-key-store";
import { notifyConversation } from "@/lib/push";
import { clearAppBadge } from "@/lib/badge";
import { VerifyContactDialog } from "@/components/verify-contact-dialog";
import {
  loadVerifications,
  reconcileVerification,
  type VerificationState,
} from "@/lib/verification";

export const Route = createFileRoute("/_authenticated/chat/$id")({
  component: ChatView,
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type DbMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string | null;
  ciphertext: string;
  nonce: string;
  type: "text" | "image";
  attachment_path: string | null;
  created_at: string;
};

type RenderedMessage = {
  id: string;
  sender_id: string;
  created_at: string;
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
  failed?: boolean;
  pending?: boolean;
};

type Member = { user_id: string; display_name: string; public_key: string | null };

async function stripExifAndCompress(file: File): Promise<Uint8Array> {
  if (!file.type.startsWith("image/")) {
    return new Uint8Array(await file.arrayBuffer());
  }
  const bmp = await createImageBitmap(file);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.85)!);
  return new Uint8Array(await blob.arrayBuffer());
}

function ChatView() {
  const { id: convId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const [conv, setConv] = useState<{ type: "direct" | "group"; name: string | null } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [text, setText] = useState("");
  const [privKey, setPrivKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verification, setVerification] = useState<Map<string, VerificationState>>(new Map());
  const [dismissedChanges, setDismissedChanges] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sleutel laden
  useEffect(() => {
    sodiumReady().then(() => loadPrivateKey(user.id)).then(setPrivKey);
    void clearAppBadge();
  }, [user.id]);

  // Conversation + members laden
  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("conversations")
        .select("type, name")
        .eq("id", convId)
        .maybeSingle();
      setConv(c as any);

      const { data: ms } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", convId);
      const userIds = (ms ?? []).map((m) => m.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, public_key")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      setMembers(
        (profs ?? []).map((p) => ({
          user_id: p.id,
          display_name: p.display_name,
          public_key: p.public_key,
        })),
      );
    })();
  }, [convId]);

  const memberById = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  const otherMembers = useMemo(
    () => members.filter((m) => m.user_id !== user.id),
    [members, user.id],
  );

  // Reconcile verificaties met huidige publieke sleutels (lokaal, server beslist niets).
  const reconcile = useCallback(async () => {
    if (otherMembers.length === 0) return;
    const cached = await loadVerifications(
      user.id,
      otherMembers.map((m) => m.user_id),
    );
    const next = new Map<string, VerificationState>();
    for (const m of otherMembers) {
      const state = await reconcileVerification(
        user.id,
        m.user_id,
        m.public_key,
        cached.get(m.user_id),
      );
      next.set(m.user_id, state);
    }
    setVerification(next);
  }, [otherMembers, user.id]);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  // Realtime: detecteer sleutelrotatie van een deelnemer terwijl de chat openstaat.
  // Bij elke UPDATE op een profiel van een huidig lid werken we members bij; als de
  // public_key veranderde, hertriggert de bestaande reconcile de amber-banner direct.
  useEffect(() => {
    const ids = otherMembers.map((m) => m.user_id);
    if (ids.length === 0) return;
    const channel = supabase
      .channel(`profiles:chat:${convId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=in.(${ids.join(",")})` },
        (payload) => {
          const row = payload.new as { id: string; display_name: string; public_key: string | null };
          setMembers((prev) =>
            prev.map((m) =>
              m.user_id === row.id
                ? { ...m, display_name: row.display_name, public_key: row.public_key }
                : m,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [convId, otherMembers]);


  // Berichten laden + realtime
  useEffect(() => {
    if (!privKey) return;
    let cancelled = false;
    const imageBlobUrls: string[] = [];

    async function decryptOne(m: DbMessage): Promise<RenderedMessage> {
      try {
        const sender = memberById.get(m.sender_id);
        // bij eigen verzending lazen we via ontvanger; voor eigen berichten staat recipient_id op de ander.
        // Voor eigen weergave decrypten we met onze eigen private + zenders publieke; werkt voor inkomend.
        // Voor uitgaand kan recipient_id == ons zelf zijn (group: 1 rij per lid incl. zelf).
        const otherPub = sender?.public_key;
        if (!otherPub) throw new Error("Geen publieke sleutel afzender");
        const plaintext = await decryptMessage(
          { ciphertext: m.ciphertext, nonce: m.nonce },
          otherPub,
          privKey!,
        );
        if (m.type === "image" && m.attachment_path) {
          // text bevat JSON met file-key + nonce
          const meta = JSON.parse(plaintext) as { key: string; nonce: string; mime?: string };
          const { data: signed } = await supabase.storage
            .from("attachments")
            .createSignedUrl(m.attachment_path, 300);
          if (!signed?.signedUrl) throw new Error("Geen signed URL");
          const enc = new Uint8Array(await (await fetch(signed.signedUrl)).arrayBuffer());
          const plainBytes = await decryptFile(enc, meta.nonce, meta.key);
          const blob = new Blob([plainBytes.buffer as ArrayBuffer], { type: meta.mime ?? "image/jpeg" });
          const url = URL.createObjectURL(blob);
          imageBlobUrls.push(url);
          return { id: m.id, sender_id: m.sender_id, created_at: m.created_at, type: "image", imageUrl: url };
        }
        return { id: m.id, sender_id: m.sender_id, created_at: m.created_at, type: "text", text: plaintext };
      } catch (e) {
        return { id: m.id, sender_id: m.sender_id, created_at: m.created_at, type: m.type, text: "🔒 (kon niet ontsleutelen)", failed: true };
      }
    }

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      const rows = (data as DbMessage[]) ?? [];
      // toon één bericht per (sender_id, created_at) — bij groepen schrijven we 1 rij per lid; dedupliceer voor de afzender.
      const seen = new Set<string>();
      const unique: DbMessage[] = [];
      for (const m of rows) {
        // Eigen kant: alleen rijen waar recipient_id === user.id (zo gegarandeerd te ontsleutelen)
        if (m.sender_id === user.id) {
          if (m.recipient_id !== user.id) continue;
        } else {
          if (m.recipient_id !== user.id) continue;
        }
        const k = `${m.sender_id}-${m.created_at}-${m.type}`;
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(m);
      }
      const rendered = await Promise.all(unique.map(decryptOne));
      if (!cancelled) setMessages(rendered);
    }

    void load();

    const ch = supabase
      .channel(`chat:${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        async (payload) => {
          const m = payload.new as DbMessage;
          if (m.recipient_id !== user.id) return;
          const rendered = await decryptOne(m);
          setMessages((prev) => {
            if (prev.some((p) => p.id === rendered.id)) return prev;
            return [...prev, rendered];
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      imageBlobUrls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, privKey, memberById, user.id]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || !privKey) return;
    setText("");
    setBusy(true);
    try {
      await sendEncrypted({ kind: "text", plaintext: body });
    } catch (e: any) {
      toast.error(e?.message ?? "Verzenden mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(f: File) {
    if (!privKey) return;
    if (f.size > MAX_IMAGE_BYTES * 2) {
      toast.error("Bestand is te groot (max ~10MB)");
      return;
    }
    setBusy(true);
    try {
      const bytes = await stripExifAndCompress(f);
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        toast.error("Afbeelding na compressie nog te groot");
        return;
      }
      const enc = await encryptFile(bytes);
      // Pad: conversation_id/uuid.enc
      const path = `${convId}/${crypto.randomUUID()}.enc`;
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, new Blob([enc.ciphertext.buffer as ArrayBuffer], { type: "application/octet-stream" }), {
          contentType: "application/octet-stream",
        });
      if (upErr) throw upErr;
      const meta = JSON.stringify({ key: enc.key, nonce: enc.nonce, mime: "image/jpeg" });
      await sendEncrypted({ kind: "image", plaintext: meta, attachmentPath: path });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function sendEncrypted(opts: { kind: "text" | "image"; plaintext: string; attachmentPath?: string }) {
    if (!privKey) return;
    const created_at = new Date().toISOString();
    // Per lid (inclusief jezelf, zodat je je eigen bericht ook terugziet) één rij.
    const rows = [];
    for (const m of members) {
      if (!m.public_key) {
        toast.error(`${m.display_name} heeft geen sleutel — bericht wordt overgeslagen.`);
        continue;
      }
      const enc = await encryptMessage(opts.plaintext, m.public_key, privKey);
      rows.push({
        conversation_id: convId,
        sender_id: user.id,
        recipient_id: m.user_id,
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
        type: opts.kind,
        attachment_path: opts.attachmentPath ?? null,
        created_at,
      });
    }
    if (rows.length === 0) return;
    const { error } = await supabase.from("messages").insert(rows);
    if (error) throw error;
    // bump conversation updated_at
    await supabase.from("conversations").update({ updated_at: created_at }).eq("id", convId);
    // Stuur neutrale push naar andere leden (fire-and-forget)
    void notifyConversation(convId);
  }

  const title = conv?.type === "group"
    ? conv.name ?? "Groep"
    : memberById.get(members.find((m) => m.user_id !== user.id)?.user_id ?? "")?.display_name ?? "Chat";

  const subtitle = conv?.type === "group"
    ? members.map((m) => m.display_name).join(", ")
    : "🔒 End-to-end versleuteld";

  // Voor de header-badge bij direct chats: status van de andere persoon.
  const directOther = conv?.type === "direct" ? otherMembers[0] : null;
  const directState = directOther ? verification.get(directOther.user_id) : undefined;

  // Banners: alle leden waarvan de sleutel net is veranderd én die je niet hebt weggeklikt.
  const changedMembers = otherMembers.filter((m) => {
    const s = verification.get(m.user_id);
    return s?.kind === "changed" && !dismissedChanges.has(m.user_id);
  });

  return (
    <div className="h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-2 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/chats" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-sm font-semibold">
          {initials(title)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate flex items-center gap-1.5">
            <span className="truncate">{title}</span>
            {directState?.kind === "verified" && (
              <span title="Geverifieerd op dit toestel">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              </span>
            )}
          </div>
          <div className="text-xs opacity-80 truncate flex items-center gap-1">
            {directState?.kind === "verified" ? (
              <>
                <ShieldCheck className="w-3 h-3" /> Geverifieerd · {subtitle}
              </>
            ) : (
              <>
                <ShieldQuestion className="w-3 h-3" /> Niet geverifieerd · {subtitle}
              </>
            )}
          </div>
        </div>
        {otherMembers.length > 0 && (
          <button
            type="button"
            onClick={() => setVerifyOpen(true)}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Contact verifiëren"
            title="Contact verifiëren via QR"
          >
            <QrCode className="w-5 h-5" />
          </button>
        )}
      </header>

      <VerifyContactDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        ownerId={user.id}
        candidates={otherMembers}
        onVerified={() => {
          void reconcile();
        }}
      />

      {changedMembers.length > 0 && (
        <div className="bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border-b border-amber-300/50 px-3 py-2 text-sm flex flex-col gap-1">
          {changedMembers.map((m) => (
            <div key={m.user_id} className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                De sleutel van <span className="font-medium">{m.display_name}</span> is gewijzigd.
                Dit kan onschuldig zijn (nieuw apparaat), maar verifieer opnieuw via QR om zeker te zijn.
                <button
                  type="button"
                  onClick={() => setVerifyOpen(true)}
                  className="ml-2 underline font-medium"
                >
                  Nu verifiëren
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDismissedChanges((prev) => {
                    const n = new Set(prev);
                    n.add(m.user_id);
                    return n;
                  })
                }
                className="p-1 rounded hover:bg-amber-200/50"
                aria-label="Sluiten"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-surface px-3 py-4 space-y-2">
        {messages.map((m, i) => {
          const own = m.sender_id === user.id;
          const sender = memberById.get(m.sender_id);
          const showSender = conv?.type === "group" && !own && (i === 0 || messages[i - 1].sender_id !== m.sender_id);
          return (
            <div key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div
                className={`relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
                  own
                    ? "bg-bubble-out text-bubble-out-foreground bubble-out rounded-br-sm"
                    : "bg-bubble-in text-bubble-in-foreground bubble-in rounded-bl-sm"
                }`}
              >
                {showSender && (
                  <div className="text-xs font-semibold text-primary mb-0.5">{sender?.display_name}</div>
                )}
                {m.type === "image" && m.imageUrl ? (
                  <img src={m.imageUrl} alt="" className="rounded-lg max-h-72 mb-1" />
                ) : null}
                {m.text && (
                  <div className={`whitespace-pre-wrap break-words text-[15px] ${m.failed ? "italic opacity-70" : ""}`}>
                    {m.text}
                  </div>
                )}
                <div className="text-[10px] opacity-60 text-right mt-0.5">{formatTime(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground mt-10 px-6">
            🔒 Berichten zijn end-to-end versleuteld. De server ziet alleen ciphertext.
          </div>
        )}
      </div>

      <div className="bg-card border-t p-2 flex items-end gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="p-3 text-muted-foreground hover:text-foreground"
          aria-label="Bijlage"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Bericht…"
          rows={1}
          className="flex-1 resize-none bg-input/40 rounded-2xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-ring max-h-32"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          size="icon"
          onClick={send}
          disabled={busy || !text.trim()}
          className="rounded-full h-11 w-11 shrink-0"
        >
          <Send className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
