// Dialog om een doelgesprek te kiezen (gebruikt voor "Doorsturen").

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AvatarCircle } from "@/components/avatar-circle";
import { Users } from "lucide-react";

type Conv = {
  id: string;
  type: "direct" | "group";
  name: string | null;
  display: string;
  avatar: string | null;
};

export function ConversationPicker({
  open,
  onOpenChange,
  ownerId,
  excludeConversationId,
  onPick,
  title = "Doorsturen naar…",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  excludeConversationId?: string;
  onPick: (conversationId: string) => void;
  title?: string;
}) {
  const [list, setList] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: mine } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", ownerId);
      const ids = (mine ?? []).map((r) => r.conversation_id);
      if (ids.length === 0) {
        if (!cancelled) setList([]);
        setLoading(false);
        return;
      }
      const { data: cs } = await supabase
        .from("conversations")
        .select("id, type, name, updated_at")
        .in("id", ids)
        .order("updated_at", { ascending: false });
      const convs = (cs ?? []) as Array<{ id: string; type: "direct" | "group"; name: string | null }>;
      const { data: ms } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", ids);
      const userIds = Array.from(new Set((ms ?? []).map((m) => m.user_id)));
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      const pmap = new Map((profs ?? []).map((p) => [p.id, p]));
      const grouped = new Map<string, Array<{ user_id: string; display_name: string; avatar_url: string | null }>>();
      for (const m of ms ?? []) {
        const prof = pmap.get(m.user_id);
        if (!prof) continue;
        const arr = grouped.get(m.conversation_id) ?? [];
        arr.push({ user_id: m.user_id, display_name: prof.display_name, avatar_url: prof.avatar_url });
        grouped.set(m.conversation_id, arr);
      }
      const result: Conv[] = convs
        .filter((c) => c.id !== excludeConversationId)
        .map((c) => {
          if (c.type === "group") {
            return { id: c.id, type: "group", name: c.name, display: c.name ?? "Groep", avatar: null };
          }
          const other = grouped.get(c.id)?.find((m) => m.user_id !== ownerId);
          return {
            id: c.id,
            type: "direct",
            name: null,
            display: other?.display_name ?? "Onbekend",
            avatar: other?.avatar_url ?? null,
          };
        });
      if (!cancelled) setList(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ownerId, excludeConversationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && <div className="p-6 text-center text-sm text-muted-foreground">Laden…</div>}
          {!loading && list.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">Geen andere gesprekken.</div>
          )}
          <ul className="divide-y">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left"
                >
                  {c.type === "group" ? (
                    <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                  ) : (
                    <AvatarCircle name={c.display} avatarUrl={c.avatar} size={40} />
                  )}
                  <span className="font-medium truncate">{c.display}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
