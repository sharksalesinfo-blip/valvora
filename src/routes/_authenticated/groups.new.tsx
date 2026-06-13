import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/groups/new")({
  component: NewGroup,
});

type Profile = { id: string; display_name: string; public_key: string | null };

function NewGroup() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const [people, setPeople] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, display_name, public_key")
      .neq("id", user.id)
      .order("display_name")
      .then(({ data }) => setPeople((data as Profile[]) ?? []));
  }, [user.id]);

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function create() {
    if (!name.trim()) return toast.error("Geef de groep een naam");
    if (picked.size === 0) return toast.error("Kies minstens één deelnemer");
    setBusy(true);
    try {
      const { data: conv, error } = await supabase
        .from("conversations")
        .insert({ type: "group", name: name.trim(), created_by: user.id })
        .select("id")
        .single();
      if (error || !conv) throw error ?? new Error("Kon groep niet aanmaken");
      const memRows = [{ conversation_id: conv.id, user_id: user.id }, ...Array.from(picked).map((uid) => ({ conversation_id: conv.id, user_id: uid }))];
      const { error: mErr } = await supabase.from("conversation_members").insert(memRows);
      if (mErr) throw mErr;
      nav({ to: "/chat/$id", params: { id: conv.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-3 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/new" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-lg font-semibold">Nieuwe groep</h1>
      </header>
      <div className="p-4 space-y-3 border-b bg-card">
        <Input placeholder="Groepsnaam" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-xs text-muted-foreground">{picked.size} deelnemer{picked.size === 1 ? "" : "s"} gekozen</p>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y">
        {people.map((p) => {
          const on = picked.has(p.id);
          const disabled = !p.public_key;
          return (
            <li key={p.id}>
              <button
                disabled={disabled}
                onClick={() => toggle(p.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 ${disabled ? "opacity-50" : ""}`}
              >
                <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold">
                  {initials(p.display_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.display_name}</div>
                  {disabled && <div className="text-xs text-muted-foreground">Nog geen sleutel</div>}
                </div>
                <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${on ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30"}`}>
                  {on && <Check className="w-4 h-4" />}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="p-4 bg-card border-t">
        <Button onClick={create} disabled={busy} className="w-full">
          {busy ? "Bezig…" : "Groep aanmaken"}
        </Button>
      </div>
    </div>
  );
}
