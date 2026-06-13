import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Users, User as UserIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { initials } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/new")({
  component: NewChat,
});

type Profile = { id: string; display_name: string; avatar_url: string | null; public_key: string | null };

function NewChat() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const [people, setPeople] = useState<Profile[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, public_key")
      .neq("id", user.id)
      .order("display_name")
      .then(({ data }) => setPeople((data as Profile[]) ?? []));
  }, [user.id]);

  async function startDirect(p: Profile) {
    if (!p.public_key) {
      toast.error(`${p.display_name} heeft nog geen sleutel — vraag ze de app even te openen.`);
      return;
    }
    // Bestaand 1-op-1 gesprek zoeken
    const { data: mine } = await supabase
      .from("conversation_members")
      .select("conversation_id, conversations!inner(type)")
      .eq("user_id", user.id);
    const myDirectIds = (mine ?? [])
      .filter((m: any) => m.conversations?.type === "direct")
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

  const filtered = people.filter((p) => p.display_name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-3 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/chats" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-lg font-semibold">Nieuw gesprek</h1>
      </header>
      <div className="p-3">
        <Input placeholder="Zoeken…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                <div className="text-xs text-muted-foreground">
                  {p.public_key ? "🔒 Sleutel beschikbaar" : "⚠️ Geen sleutel (nog niet ingelogd)"}
                </div>
              </div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">Geen contacten gevonden.</li>
        )}
      </ul>
    </div>
  );
}
