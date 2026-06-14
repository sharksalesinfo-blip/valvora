import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatTime } from "@/lib/format";
import { Plus, Users, ShieldCheck, User as UserIcon } from "lucide-react";
import { AvatarCircle } from "@/components/avatar-circle";

export const Route = createFileRoute("/_authenticated/chats")({
  component: ChatsPage,
});

type ConvRow = {
  id: string;
  type: "direct" | "group";
  name: string | null;
  updated_at: string;
};

type Member = {
  conversation_id: string;
  user_id: string;
  profiles?: { display_name: string; avatar_url: string | null } | null;
};

function ChatsPage() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [lastMsg, setLastMsg] = useState<Record<string, { created_at: string }>>({});

  async function load() {
    const { data: myMem } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);
    const ids = (myMem ?? []).map((m) => m.conversation_id);
    if (ids.length === 0) {
      setConvs([]);
      return;
    }
    const { data: cs } = await supabase
      .from("conversations")
      .select("id, type, name, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    setConvs((cs as ConvRow[]) ?? []);

    const { data: ms } = await supabase
      .from("conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", ids);
    const userIds = Array.from(new Set((ms ?? []).map((m) => m.user_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const grouped: Record<string, Member[]> = {};
    for (const m of ms ?? []) {
      const prof = pmap.get(m.user_id);
      (grouped[m.conversation_id] ||= []).push({
        conversation_id: m.conversation_id,
        user_id: m.user_id,
        profiles: prof ? { display_name: prof.display_name, avatar_url: prof.avatar_url } : null,
      });
    }
    setMembers(grouped);

    const { data: last } = await supabase
      .from("messages")
      .select("conversation_id, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false });
    const lm: Record<string, { created_at: string }> = {};
    for (const r of last ?? []) {
      if (!lm[r.conversation_id]) lm[r.conversation_id] = { created_at: r.created_at };
    }
    setLastMsg(lm);
  }

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("chats-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  function displayFor(c: ConvRow): { name: string; avatar: string | null } {
    if (c.type === "group") return { name: c.name ?? "Groep", avatar: null };
    const other = members[c.id]?.find((m) => m.user_id !== user.id);
    return { name: other?.profiles?.display_name ?? "Onbekend", avatar: other?.profiles?.avatar_url ?? null };
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-4 py-3 flex items-center justify-between sticky top-0 z-10 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight tracking-tight">valvora</h1>
            <p className="text-xs opacity-70 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> End-to-end versleuteld</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/profile" className="p-2 rounded-full hover:bg-white/10" aria-label="Profiel">
            <UserIcon className="w-5 h-5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {convs.length === 0 ? (
          <div className="text-center text-muted-foreground py-20 px-6">
            <p>Nog geen gesprekken.</p>
            <p className="text-sm mt-2">Tik op + om iemand uit je kring te chatten.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {convs.map((c) => {
              const d = displayFor(c);
              const last = lastMsg[c.id];
              return (
                <li key={c.id}>
                  <Link
                    to="/chat/$id"
                    params={{ id: c.id }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted transition-colors"
                  >
                    {c.type === "group" ? (
                      <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold shrink-0">
                        <Users className="w-5 h-5" />
                      </div>
                    ) : (
                      <AvatarCircle name={d.name} avatarUrl={d.avatar} size={48} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <span className="font-medium truncate">{d.name}</span>
                        {last && <span className="text-xs text-muted-foreground shrink-0 ml-2">{formatTime(last.created_at)}</span>}
                      </div>
                      {!last && (
                        <p className="text-sm text-muted-foreground truncate">Nog geen berichten</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <Link
        to="/new"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        aria-label="Nieuw gesprek"
      >
        <Plus className="w-6 h-6" />
      </Link>
    </div>
  );
}
