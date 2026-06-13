import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Users, Share2, Copy, Search, UserPlus, AtSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { toast } from "sonner";
import { addByHandle, getMyInvite } from "@/lib/contacts.functions";
import { buildInviteUrl } from "@/lib/pending-invite";

export const Route = createFileRoute("/_authenticated/new")({
  component: NewChat,
});

type Contact = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  public_key: string | null;
  handle: string | null;
};

function NewChat() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const [people, setPeople] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [handleQuery, setHandleQuery] = useState("");
  const [handleBusy, setHandleBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  const callAddByHandle = useServerFn(addByHandle);
  const fetchInvite = useServerFn(getMyInvite);

  async function loadContacts() {
    const { data: rows } = await supabase
      .from("contacts")
      .select("contact_user_id")
      .eq("owner_id", user.id);
    const ids = (rows ?? []).map((r) => r.contact_user_id);
    if (ids.length === 0) {
      setPeople([]);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, public_key, handle")
      .in("id", ids)
      .order("display_name");
    setPeople((profs as Contact[]) ?? []);
  }

  useEffect(() => {
    void loadContacts();
    void fetchInvite().then((r) => setInviteUrl(buildInviteUrl(r.token))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function startDirect(p: Contact) {
    if (!p.public_key) {
      toast.error(`${p.display_name} heeft nog geen sleutel — vraag ze de app even te openen.`);
      return;
    }
    const { data: mine } = await supabase
      .from("conversation_members")
      .select("conversation_id, conversations!inner(type)")
      .eq("user_id", user.id);
    const myDirectIds = (mine ?? [])
      .filter((m: { conversations?: { type?: string } }) => m.conversations?.type === "direct")
      .map((m) => m.conversation_id);
    if (myDirectIds.length) {
      const { data: theirs } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", p.id)
        .in("conversation_id", myDirectIds);
      if (theirs && theirs.length) {
        nav({ to: "/chat/$id", params: { id: theirs[0].conversation_id } });
        return;
      }
    }
    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ type: "direct", created_by: user.id })
      .select("id")
      .single();
    if (error || !conv) {
      toast.error(error?.message ?? "Kon gesprek niet aanmaken");
      return;
    }
    const { error: memErr } = await supabase.from("conversation_members").insert([
      { conversation_id: conv.id, user_id: user.id },
      { conversation_id: conv.id, user_id: p.id },
    ]);
    if (memErr) {
      toast.error(memErr.message);
      return;
    }
    nav({ to: "/chat/$id", params: { id: conv.id } });
  }

  async function addHandle() {
    if (!handleQuery.trim()) return;
    setHandleBusy(true);
    try {
      const r = await callAddByHandle({ data: { handle: handleQuery } });
      if (r.self) {
        toast.info("Dat ben je zelf 🙂");
      } else if (r.added) {
        toast.success(`${r.display_name} toegevoegd`);
        setHandleQuery("");
        await loadContacts();
      } else {
        // Uniforme respons: we onthullen niet of de handle bestaat.
        toast.message("Geen resultaat");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Toevoegen mislukt";
      toast.error(msg);
    } finally {
      setHandleBusy(false);
    }
  }

  async function shareInvite() {
    if (!inviteUrl) return;
    const text = `Voeg me toe in de versleutelde chat: ${inviteUrl}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Uitnodiging", text, url: inviteUrl });
        return;
      } catch {
        // cancelled
      }
    }
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Link gekopieerd");
  }

  const filtered = people.filter((p) => {
    const q2 = q.toLowerCase();
    return (
      p.display_name.toLowerCase().includes(q2) ||
      (p.handle?.toLowerCase().includes(q2) ?? false)
    );
  });

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-3 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/chats" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-lg font-semibold">Nieuw gesprek</h1>
      </header>

      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          <Button onClick={shareInvite} disabled={!inviteUrl} className="flex-1">
            <Share2 className="w-4 h-4 mr-1" /> Nodig uit
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!inviteUrl) return;
              void navigator.clipboard.writeText(inviteUrl);
              toast.success("Gekopieerd");
            }}
            disabled={!inviteUrl}
            aria-label="Invite-link kopiëren"
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>

        <div className="bg-card border rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AtSign className="w-4 h-4 text-primary" /> Toevoegen op handle
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
              <Input
                value={handleQuery}
                onChange={(e) => setHandleQuery(e.target.value.replace(/^@/, ""))}
                placeholder="naam"
                className="pl-7"
                autoCapitalize="none"
                autoCorrect="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addHandle();
                }}
              />
            </div>
            <Button onClick={addHandle} disabled={handleBusy || !handleQuery.trim()}>
              <UserPlus className="w-4 h-4 mr-1" /> Toevoegen
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Zoek in je contacten…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Link to="/groups/new" className="flex items-center gap-3 px-4 py-3 border-y bg-card hover:bg-muted/50">
        <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Users className="w-5 h-5" />
        </div>
        <span className="font-medium">Nieuwe groep</span>
      </Link>

      <ul className="flex-1 overflow-y-auto divide-y">
        {filtered.map((p) => (
          <li key={p.id}>
            <button onClick={() => startDirect(p)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left">
              <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold">
                {initials(p.display_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.display_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {p.handle ? `@${p.handle}` : (p.public_key ? "🔒 Sleutel beschikbaar" : "⚠️ Geen sleutel")}
                </div>
              </div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            {people.length === 0
              ? "Nog geen contacten. Deel je invite-link of voeg iemand toe op handle."
              : "Geen contacten gevonden."}
          </li>
        )}
      </ul>
    </div>
  );
}
