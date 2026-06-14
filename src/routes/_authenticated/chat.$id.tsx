import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  Send,
  Paperclip,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  QrCode,
  X,
  Reply as ReplyIcon,
  Forward,
  Download,
  FileText,
  MapPin,
  Image as ImageIcon,
  File as FileIcon,
  CornerDownRight,
  Check,
  CheckCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { AvatarCircle } from "@/components/avatar-circle";
import { toast } from "sonner";
import {
  decryptFile,
  decryptMessage,
  encryptFile,
  sodiumReady,
} from "@/lib/crypto";
import { loadPrivateKey } from "@/lib/local-key-store";
import { clearAppBadge } from "@/lib/badge";
import { setLastRead } from "@/lib/unread";
import { VerifyContactDialog } from "@/components/verify-contact-dialog";
import {
  loadVerifications,
  reconcileVerification,
  type VerificationState,
} from "@/lib/verification";
import { decodeEnvelope, type EnvelopeV1 } from "@/lib/message-envelope";
import {
  loadConversationMembers,
  sendEnvelopeToConversation,
} from "@/lib/send-message";
import { ConversationPicker } from "@/components/conversation-picker";
import {
  aggregateStatus,
  writeStatus,
  type StatusRow,
} from "@/lib/message-status";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";


export const Route = createFileRoute("/_authenticated/chat/$id")({
  component: ChatView,
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 20 * 1024 * 1024;

type DbMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string | null;
  ciphertext: string;
  nonce: string;
  type: "text" | "image" | "file" | "location";
  attachment_path: string | null;
  created_at: string;
  reply_to_message_id: string | null;
  group_id: string;
};

type RenderedMessage = {
  id: string;
  group_id: string;
  sender_id: string;
  created_at: string;
  type: "text" | "image" | "file" | "location";
  text?: string;
  imageUrl?: string;
  file?: { name: string; mime: string; size?: number; key: string; nonce: string; path: string };
  location?: { lat: number; lng: number; acc?: number };
  fwd?: boolean;
  failed?: boolean;
  replyToId?: string | null;
};


type Member = {
  user_id: string;
  display_name: string;
  public_key: string | null;
  avatar_url: string | null;
};

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
  const blob: Blob = await new Promise((res) =>
    canvas.toBlob((b) => res(b!), "image/jpeg", 0.85)!,
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function humanSize(n?: number): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
  const [replyTo, setReplyTo] = useState<RenderedMessage | null>(null);
  const [actionFor, setActionFor] = useState<RenderedMessage | null>(null);
  const [forwardFor, setForwardFor] = useState<RenderedMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const [statuses, setStatuses] = useState<Map<string, StatusRow[]>>(new Map());
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState<boolean>(true);


  // Sleutel laden
  useEffect(() => {
    sodiumReady().then(() => loadPrivateKey(user.id)).then(setPrivKey);
    void clearAppBadge();
    setLastRead(convId);
  }, [user.id, convId]);

  // Eigen instelling voor leesbevestigingen (wederkerig: uit = geen 'read'
  // schrijven én geen blauw zien van anderen).
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("read_receipts_enabled")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setReadReceiptsEnabled(data.read_receipts_enabled ?? true);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);



  // Markeer als gelezen wanneer er nieuwe berichten binnenkomen terwijl deze chat open is.
  useEffect(() => {
    if (messages.length === 0) return;
    const onVis = () => {
      if (document.visibilityState === "visible") setLastRead(convId);
    };
    setLastRead(convId);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [convId, messages.length]);

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
        .select("id, display_name, public_key, avatar_url")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      setMembers(
        (profs ?? []).map((p) => ({
          user_id: p.id,
          display_name: p.display_name,
          public_key: p.public_key,
          avatar_url: p.avatar_url ?? null,
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

  useEffect(() => {
    const ids = otherMembers.map((m) => m.user_id);
    if (ids.length === 0) return;
    const channel = supabase
      .channel(`profiles:chat:${convId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=in.(${ids.join(",")})` },
        (payload) => {
          const row = payload.new as { id: string; display_name: string; public_key: string | null; avatar_url: string | null };
          setMembers((prev) =>
            prev.map((m) =>
              m.user_id === row.id
                ? { ...m, display_name: row.display_name, public_key: row.public_key, avatar_url: row.avatar_url ?? null }
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
        const otherPub = sender?.public_key;
        if (!otherPub) throw new Error("Geen publieke sleutel afzender");
        const plaintext = await decryptMessage(
          { ciphertext: m.ciphertext, nonce: m.nonce },
          otherPub,
          privKey!,
        );
        const env = decodeEnvelope(plaintext, m.type);

        const base = {
          id: m.id,
          group_id: m.group_id,
          sender_id: m.sender_id,
          created_at: m.created_at,
          fwd: (env as { fwd?: boolean }).fwd ?? false,
          replyToId: m.reply_to_message_id,
        };


        if (env.type === "text") {
          return { ...base, type: "text", text: env.text };
        }
        if (env.type === "location") {
          return { ...base, type: "location", location: env.location };
        }
        if ((env.type === "image" || env.type === "file") && m.attachment_path) {
          const { data: signed } = await supabase.storage
            .from("attachments")
            .createSignedUrl(m.attachment_path, 300);
          if (!signed?.signedUrl) throw new Error("Geen signed URL");
          const enc = new Uint8Array(await (await fetch(signed.signedUrl)).arrayBuffer());
          const plainBytes = await decryptFile(enc, env.file.nonce, env.file.key);
          if (env.type === "image") {
            const blob = new Blob([plainBytes.buffer as ArrayBuffer], { type: env.file.mime ?? "image/jpeg" });
            const url = URL.createObjectURL(blob);
            imageBlobUrls.push(url);
            return {
              ...base,
              type: "image",
              imageUrl: url,
              file: { ...env.file, name: env.file.name ?? "afbeelding.jpg", path: m.attachment_path },
            };
          }
          // file: keep decrypted bytes available via blob URL on-demand
          const blob = new Blob([plainBytes.buffer as ArrayBuffer], { type: env.file.mime || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          imageBlobUrls.push(url);
          return {
            ...base,
            type: "file",
            imageUrl: url,
            file: {
              name: env.file.name ?? "bestand",
              mime: env.file.mime || "application/octet-stream",
              size: env.file.size,
              key: env.file.key,
              nonce: env.file.nonce,
              path: m.attachment_path,
            },
          };
        }
        return { ...base, type: "text", text: "(leeg)" };
      } catch {
        return {
          id: m.id,
          group_id: m.group_id,
          sender_id: m.sender_id,
          created_at: m.created_at,
          type: m.type,
          text: "🔒 (kon niet ontsleutelen)",
          failed: true,
          replyToId: m.reply_to_message_id,
        };

      }
    }

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      const rows = (data as DbMessage[]) ?? [];
      const seen = new Set<string>();
      const unique: DbMessage[] = [];
      for (const m of rows) {
        if (m.recipient_id !== user.id) continue;
        const k = `${m.sender_id}-${m.created_at}-${m.type}`;
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(m);
      }
      const rendered = await Promise.all(unique.map(decryptOne));
      if (!cancelled) setMessages(rendered);
      // Schrijf 'delivered' (en als zichtbaar én leesbevestigingen aan: 'read')
      // voor binnenkomende berichten van anderen.
      const visible =
        typeof document !== "undefined" && document.visibilityState === "visible";
      for (const m of unique) {
        if (m.sender_id === user.id) continue;
        void writeStatus({
          groupId: m.group_id,
          conversationId: convId,
          userId: user.id,
          status: "delivered",
        });
        if (visible && readReceiptsEnabled) {
          void writeStatus({
            groupId: m.group_id,
            conversationId: convId,
            userId: user.id,
            status: "read",
          });
        }
      }
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
          // Statussen alleen schrijven voor berichten van anderen — niet voor
          // de eigen-kopie van wat jij zelf verstuurt (anders direct blauw).
          if (m.sender_id === user.id) return;
          // Aflevering bevestigen (en lezen als de chat open en zichtbaar is).
          void writeStatus({
            groupId: m.group_id,
            conversationId: convId,
            userId: user.id,
            status: "delivered",
          });
          if (
            typeof document !== "undefined" &&
            document.visibilityState === "visible" &&
            readReceiptsEnabled
          ) {
            void writeStatus({
              groupId: m.group_id,
              conversationId: convId,
              userId: user.id,
              status: "read",
            });
          }
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

  // Aflever-/leesstatussen laden + realtime updates voor dit gesprek.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("message_status")
        .select("group_id, user_id, status, at")
        .eq("conversation_id", convId);
      if (cancelled || !data) return;
      const map = new Map<string, StatusRow[]>();
      for (const r of data as StatusRow[]) {
        const arr = map.get(r.group_id) ?? [];
        arr.push(r);
        map.set(r.group_id, arr);
      }
      setStatuses(map);
    })();

    const ch = supabase
      .channel(`status:${convId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_status",
          filter: `conversation_id=eq.${convId}`,
        },
        (payload) => {
          const r = payload.new as StatusRow & { conversation_id: string };
          setStatuses((prev) => {
            const arr = prev.get(r.group_id) ?? [];
            if (arr.some((x) => x.user_id === r.user_id && x.status === r.status)) return prev;
            const next = new Map(prev);
            next.set(r.group_id, [...arr, { group_id: r.group_id, user_id: r.user_id, status: r.status, at: r.at }]);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [convId]);

  // Wanneer het venster zichtbaar wordt (of leesbevestigingen aangaan), 'read'
  // schrijven voor binnenkomende berichten die nog niet als gelezen gemarkeerd zijn.
  useEffect(() => {
    if (!readReceiptsEnabled) return;
    const markVisibleAsRead = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      for (const m of messages) {
        if (m.sender_id === user.id) continue;
        const rows = statuses.get(m.group_id) ?? [];
        if (rows.some((r) => r.user_id === user.id && r.status === "read")) continue;
        void writeStatus({
          groupId: m.group_id,
          conversationId: convId,
          userId: user.id,
          status: "read",
        });
      }
    };
    markVisibleAsRead();
    document.addEventListener("visibilitychange", markVisibleAsRead);
    return () => document.removeEventListener("visibilitychange", markVisibleAsRead);
  }, [messages, statuses, readReceiptsEnabled, convId, user.id]);



  async function sendText() {
    const body = text.trim();
    if (!body || !privKey) return;
    setText("");
    const reply = replyTo;
    setReplyTo(null);
    setBusy(true);
    try {
      await sendEnvelopeToConversation({
        conversationId: convId,
        senderId: user.id,
        senderPrivateKey: privKey,
        members,
        dbType: "text",
        envelope: { v: 1, type: "text", text: body },
        replyToMessageId: reply?.id ?? null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verzenden mislukt";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function sendImage(f: File) {
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
      const path = `${convId}/${crypto.randomUUID()}.enc`;
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, new Blob([enc.ciphertext.buffer as ArrayBuffer], { type: "application/octet-stream" }), {
          contentType: "application/octet-stream",
        });
      if (upErr) throw upErr;
      const envelope: EnvelopeV1 = {
        v: 1,
        type: "image",
        file: { key: enc.key, nonce: enc.nonce, mime: "image/jpeg", name: f.name, size: bytes.byteLength },
      };
      const reply = replyTo;
      setReplyTo(null);
      await sendEnvelopeToConversation({
        conversationId: convId,
        senderId: user.id,
        senderPrivateKey: privKey,
        members,
        dbType: "image",
        envelope,
        attachmentPath: path,
        replyToMessageId: reply?.id ?? null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload mislukt";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function sendDocument(f: File) {
    if (!privKey) return;
    if (f.size > MAX_DOC_BYTES) {
      toast.error("Bestand is te groot (max 20MB)");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const enc = await encryptFile(bytes);
      const path = `${convId}/${crypto.randomUUID()}.enc`;
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, new Blob([enc.ciphertext.buffer as ArrayBuffer], { type: "application/octet-stream" }), {
          contentType: "application/octet-stream",
        });
      if (upErr) throw upErr;
      const envelope: EnvelopeV1 = {
        v: 1,
        type: "file",
        file: {
          key: enc.key,
          nonce: enc.nonce,
          mime: f.type || "application/octet-stream",
          name: f.name,
          size: bytes.byteLength,
        },
      };
      const reply = replyTo;
      setReplyTo(null);
      await sendEnvelopeToConversation({
        conversationId: convId,
        senderId: user.id,
        senderPrivateKey: privKey,
        members,
        dbType: "file",
        envelope,
        attachmentPath: path,
        replyToMessageId: reply?.id ?? null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload mislukt";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function shareLocation() {
    if (!privKey) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.error("Locatie niet ondersteund op dit toestel");
      return;
    }
    setLocationBusy(true);
    try {
      const pos: GeolocationPosition = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }),
      );
      const envelope: EnvelopeV1 = {
        v: 1,
        type: "location",
        location: {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          acc: Math.round(pos.coords.accuracy),
        },
      };
      const reply = replyTo;
      setReplyTo(null);
      await sendEnvelopeToConversation({
        conversationId: convId,
        senderId: user.id,
        senderPrivateKey: privKey,
        members,
        dbType: "location",
        envelope,
        replyToMessageId: reply?.id ?? null,
      });
      setLocationOpen(false);
    } catch (e: unknown) {
      const msg =
        e instanceof GeolocationPositionError || (e && typeof e === "object" && "code" in e)
          ? "Geen toestemming of geen locatie beschikbaar"
          : e instanceof Error
            ? e.message
            : "Locatie ophalen mislukt";
      toast.error(msg);
    } finally {
      setLocationBusy(false);
    }
  }

  async function forwardTo(targetConvId: string) {
    const src = forwardFor;
    if (!src || !privKey) return;
    setForwardFor(null);
    setBusy(true);
    try {
      const targetMembers = await loadConversationMembers(targetConvId);
      if (targetMembers.length === 0) throw new Error("Geen leden gevonden");

      if (src.type === "text") {
        await sendEnvelopeToConversation({
          conversationId: targetConvId,
          senderId: user.id,
          senderPrivateKey: privKey,
          members: targetMembers,
          dbType: "text",
          envelope: { v: 1, type: "text", text: src.text ?? "", fwd: true },
        });
      } else if (src.type === "location" && src.location) {
        await sendEnvelopeToConversation({
          conversationId: targetConvId,
          senderId: user.id,
          senderPrivateKey: privKey,
          members: targetMembers,
          dbType: "location",
          envelope: { v: 1, type: "location", location: src.location, fwd: true },
        });
      } else if ((src.type === "image" || src.type === "file") && src.file) {
        // Re-encrypt het bestand met een NIEUWE sleutel en upload onder het doelpad
        // (storage-RLS staat alleen leden toe te lezen via het pad-prefix).
        const blob = await (await fetch(src.imageUrl!)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const enc = await encryptFile(bytes);
        const path = `${targetConvId}/${crypto.randomUUID()}.enc`;
        const { error: upErr } = await supabase.storage
          .from("attachments")
          .upload(path, new Blob([enc.ciphertext.buffer as ArrayBuffer], { type: "application/octet-stream" }), {
            contentType: "application/octet-stream",
          });
        if (upErr) throw upErr;
        const envelope: EnvelopeV1 = {
          v: 1,
          type: src.type,
          file: {
            key: enc.key,
            nonce: enc.nonce,
            mime: src.file.mime,
            name: src.file.name,
            size: src.file.size,
          },
          fwd: true,
        };
        await sendEnvelopeToConversation({
          conversationId: targetConvId,
          senderId: user.id,
          senderPrivateKey: privKey,
          members: targetMembers,
          dbType: src.type,
          envelope,
          attachmentPath: path,
        });
      }
      toast.success("Doorgestuurd");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Doorsturen mislukt";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function downloadFile(m: RenderedMessage) {
    if (!m.file || !m.imageUrl) return;
    const a = document.createElement("a");
    a.href = m.imageUrl;
    a.download = m.file.name || "bestand";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function startLongPress(m: RenderedMessage) {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setActionFor(m);
    }, 450);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function scrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      toast.message("Origineel bericht niet beschikbaar");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
  }

  function previewOf(m: RenderedMessage): string {
    if (m.type === "text") return (m.text ?? "").slice(0, 80);
    if (m.type === "image") return "📷 Afbeelding";
    if (m.type === "file") return `📎 ${m.file?.name ?? "Bestand"}`;
    if (m.type === "location") return "📍 Locatie";
    return "";
  }

  const title = conv?.type === "group"
    ? conv.name ?? "Groep"
    : memberById.get(members.find((m) => m.user_id !== user.id)?.user_id ?? "")?.display_name ?? "Chat";

  const subtitle = conv?.type === "group"
    ? members.map((m) => m.display_name).join(", ")
    : "🔒 End-to-end versleuteld";

  const directOther = conv?.type === "direct" ? otherMembers[0] : null;
  const directState = directOther ? verification.get(directOther.user_id) : undefined;

  const changedMembers = otherMembers.filter((m) => {
    const s = verification.get(m.user_id);
    return s?.kind === "changed" && !dismissedChanges.has(m.user_id);
  });

  const messagesById = useMemo(() => {
    const m = new Map<string, RenderedMessage>();
    for (const x of messages) m.set(x.id, x);
    return m;
  }, [messages]);

  return (
    <div className="h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-2 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/chats" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <AvatarCircle name={title} avatarUrl={directOther?.avatar_url ?? null} size={40} />
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
          const replied = m.replyToId ? messagesById.get(m.replyToId) : undefined;
          return (
            <div key={m.id} id={`msg-${m.id}`} className={`flex ${own ? "justify-end" : "justify-start"} transition-shadow rounded-2xl`}>
              <div
                className={`relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm select-none ${
                  own
                    ? "bg-bubble-out text-bubble-out-foreground bubble-out rounded-br-sm"
                    : "bg-bubble-in text-bubble-in-foreground bubble-in rounded-bl-sm"
                }`}
                onPointerDown={() => startLongPress(m)}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActionFor(m);
                }}
              >
                {showSender && (
                  <div className="text-xs font-semibold text-primary mb-0.5">{sender?.display_name}</div>
                )}
                {m.fwd && (
                  <div className="text-[11px] italic opacity-70 mb-1 flex items-center gap-1">
                    <Forward className="w-3 h-3" /> Doorgestuurd
                  </div>
                )}
                {m.replyToId && (
                  <button
                    type="button"
                    onClick={() => scrollToMessage(m.replyToId!)}
                    className="block w-full text-left mb-1 rounded-md border-l-2 border-primary/70 bg-black/5 dark:bg-white/10 px-2 py-1 text-xs"
                  >
                    <div className="font-medium text-primary truncate">
                      {replied ? memberById.get(replied.sender_id)?.display_name ?? "Onbekend" : "Origineel"}
                    </div>
                    <div className="opacity-80 truncate">
                      {replied ? previewOf(replied) : "Origineel bericht niet beschikbaar"}
                    </div>
                  </button>
                )}
                {m.type === "image" && m.imageUrl ? (
                  <img src={m.imageUrl} alt="" className="rounded-lg max-h-72 mb-1" />
                ) : null}
                {m.type === "file" && m.file ? (
                  <button
                    type="button"
                    onClick={() => downloadFile(m)}
                    className="flex items-center gap-2 rounded-lg bg-black/5 dark:bg-white/10 px-2 py-2 mb-1 text-left w-full"
                  >
                    <FileText className="w-6 h-6 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.file.name}</div>
                      <div className="text-[11px] opacity-70">{humanSize(m.file.size)}</div>
                    </div>
                    <Download className="w-4 h-4 opacity-70" />
                  </button>
                ) : null}
                {m.type === "location" && m.location ? (
                  <LocationCard location={m.location} />
                ) : null}
                {m.text && m.type === "text" && (
                  <div className={`whitespace-pre-wrap break-words text-[15px] ${m.failed ? "italic opacity-70" : ""}`}>
                    {m.text}
                  </div>
                )}
                {m.failed && m.type !== "text" && (
                  <div className="text-xs italic opacity-70">{m.text}</div>
                )}
                <div className="text-[10px] opacity-60 text-right mt-0.5 flex items-center justify-end gap-1">
                  <span>{formatTime(m.created_at)}</span>
                  {own && !m.failed && (() => {
                    const rows = statuses.get(m.group_id) ?? [];
                    const agg = aggregateStatus({
                      rowsForGroup: rows,
                      otherMemberCount: Math.max(0, members.length - 1),
                      showRead: readReceiptsEnabled,
                      selfUserId: user.id,
                    });
                    if (agg === "read") {
                      return <CheckCheck className="w-3.5 h-3.5 text-sky-400" aria-label="Gelezen" />;
                    }
                    if (agg === "delivered") {
                      return <CheckCheck className="w-3.5 h-3.5 opacity-80" aria-label="Afgeleverd" />;
                    }
                    return <Check className="w-3.5 h-3.5 opacity-80" aria-label="Verstuurd" />;
                  })()}
                </div>

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

      {/* Reply preview */}
      {replyTo && (
        <div className="bg-muted/60 border-t px-3 py-2 flex items-center gap-2">
          <CornerDownRight className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-primary truncate">
              Antwoorden op {memberById.get(replyTo.sender_id)?.display_name ?? "Onbekend"}
            </div>
            <div className="text-xs text-muted-foreground truncate">{previewOf(replyTo)}</div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="p-1 rounded hover:bg-muted"
            aria-label="Annuleren"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-card border-t p-2 flex items-end gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendImage(f);
            e.target.value = "";
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendDocument(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => setAttachOpen(true)}
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
              void sendText();
            }
          }}
        />
        <Button
          size="icon"
          onClick={sendText}
          disabled={busy || !text.trim()}
          className="rounded-full h-11 w-11 shrink-0"
        >
          <Send className="w-5 h-5" />
        </Button>
      </div>

      {/* Attachment chooser */}
      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Bijlage toevoegen</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              type="button"
              className="flex flex-col items-center gap-1 py-3 rounded-lg hover:bg-muted"
              onClick={() => {
                setAttachOpen(false);
                imageInputRef.current?.click();
              }}
            >
              <ImageIcon className="w-6 h-6 text-primary" />
              <span className="text-xs">Foto</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-1 py-3 rounded-lg hover:bg-muted"
              onClick={() => {
                setAttachOpen(false);
                docInputRef.current?.click();
              }}
            >
              <FileIcon className="w-6 h-6 text-primary" />
              <span className="text-xs">Document</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-1 py-3 rounded-lg hover:bg-muted"
              onClick={() => {
                setAttachOpen(false);
                setLocationOpen(true);
              }}
            >
              <MapPin className="w-6 h-6 text-primary" />
              <span className="text-xs">Locatie</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Location share confirm */}
      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Locatie delen</DialogTitle>
            <DialogDescription>
              Eénmalige momentopname van je huidige locatie. Geen live-tracking. De coördinaten worden
              versleuteld verzonden — de server ziet ze niet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLocationOpen(false)} disabled={locationBusy}>
              Annuleren
            </Button>
            <Button onClick={shareLocation} disabled={locationBusy}>
              {locationBusy ? "Bezig…" : "Locatie delen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Long-press actions */}
      <Dialog open={!!actionFor} onOpenChange={(o) => !o && setActionFor(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Bericht</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                if (actionFor) setReplyTo(actionFor);
                setActionFor(null);
              }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted text-left"
            >
              <ReplyIcon className="w-5 h-5 text-primary" />
              <span>Antwoorden</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (actionFor) setForwardFor(actionFor);
                setActionFor(null);
              }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted text-left"
            >
              <Forward className="w-5 h-5 text-primary" />
              <span>Doorsturen</span>
            </button>
            {actionFor?.type === "file" && (
              <button
                type="button"
                onClick={() => {
                  if (actionFor) downloadFile(actionFor);
                  setActionFor(null);
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted text-left"
              >
                <Download className="w-5 h-5 text-primary" />
                <span>Downloaden</span>
              </button>
            )}
            {actionFor?.type === "text" && actionFor.text && (
              <button
                type="button"
                onClick={() => {
                  if (actionFor?.text) {
                    void navigator.clipboard.writeText(actionFor.text);
                    toast.success("Gekopieerd");
                  }
                  setActionFor(null);
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted text-left"
              >
                <FileText className="w-5 h-5 text-primary" />
                <span>Tekst kopiëren</span>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Forward picker */}
      <ConversationPicker
        open={!!forwardFor}
        onOpenChange={(o) => !o && setForwardFor(null)}
        ownerId={user.id}
        excludeConversationId={convId}
        onPick={(targetId) => void forwardTo(targetId)}
      />
    </div>
  );
}

function LocationCard({ location }: { location: { lat: number; lng: number; acc?: number } }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=16/${location.lat}/${location.lng}`;
  return (
    <div className="rounded-lg overflow-hidden bg-black/5 dark:bg-white/10 mb-1 w-[240px]">
      {/* Lokale, statische weergave — geen externe call totdat de gebruiker bewust opent. */}
      <div
        className="h-28 relative bg-gradient-to-br from-emerald-100 to-emerald-300 dark:from-emerald-900/40 dark:to-emerald-700/40 flex items-center justify-center"
        aria-label="Locatie"
      >
        <MapPin className="w-8 h-8 text-emerald-700 dark:text-emerald-300" />
      </div>
      <div className="px-2 py-2">
        <div className="text-xs font-medium">Gedeelde locatie</div>
        <div className="text-[11px] opacity-70 tabular-nums">
          {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          {location.acc ? ` · ±${location.acc} m` : ""}
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="mt-1 text-xs text-primary underline"
        >
          Open in kaart
        </button>
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Open in externe kaart?</DialogTitle>
            <DialogDescription>
              Door op openen te tikken open je OpenStreetMap in een nieuw tabblad. Die externe dienst
              ontvangt dan de coördinaten. Wil je doorgaan?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Annuleren</Button>
            <Button
              onClick={() => {
                window.open(mapsUrl, "_blank", "noopener,noreferrer");
                setConfirmOpen(false);
              }}
            >
              Openen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
