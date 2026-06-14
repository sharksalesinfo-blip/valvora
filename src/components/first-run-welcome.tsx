import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, KeyRound } from "lucide-react";
import { toast } from "sonner";

const DISMISS_KEY = "welcome_dismissed_v1";
const DEFAULT_NAME = "Nieuw lid";

/**
 * Eenmalige welkomstkaart voor nét aangemelde anonieme gebruikers:
 *  - vraagt een leesbare weergavenaam
 *  - waarschuwt dat het account op dit apparaat leeft
 *  - linkt naar de herstelcode in /profile
 *
 * Wordt overgeslagen zodra de gebruiker een eigen naam heeft EN de
 * waarschuwing heeft bevestigd.
 */
export function FirstRunWelcome({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dismissed = (() => {
        try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
      })();
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const needsName = !data || !data.display_name || data.display_name === DEFAULT_NAME;
      if (needsName || !dismissed) {
        setName(data?.display_name && data.display_name !== DEFAULT_NAME ? data.display_name : "");
        setShow(true);
      } else {
        onDone();
      }
    })();
    return () => { cancelled = true; };
  }, [userId, onDone]);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      toast.error("Kies een naam van 1 tot 60 tekens");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", userId);
      if (error) throw error;
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
      setShow(false);
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <img src="/icon-192.png" alt="valvora" className="mx-auto w-14 h-14 rounded-2xl shadow-sm" />
          <h1 className="text-xl font-semibold mt-3">Welkom bij valvora</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bijna klaar. Kies hoe je heet en lees één belangrijk ding.
          </p>
        </div>

        <div className="bg-card border rounded-2xl p-5 space-y-3">
          <label className="text-sm font-medium">Hoe heet je?</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bv. Anna"
            autoFocus
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground">
            Dit zien je gesprekspartners. Je kunt het later aanpassen in je profiel.
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4" /> Belangrijk om te weten
          </div>
          <p className="text-sm text-amber-900 dark:text-amber-100 leading-relaxed">
            Je account leeft op <strong>dit apparaat</strong>. Verlies je dit
            apparaat of wis je je browsergegevens, dan ben je je account en
            berichtgeschiedenis kwijt — <strong>tenzij je een herstelcode hebt
            aangemaakt</strong>.
          </p>
        </div>

        <Button onClick={save} disabled={busy || name.trim().length === 0} className="w-full" size="lg">
          {busy ? "Bezig…" : "Doorgaan"}
        </Button>

        <Link
          to="/profile"
          hash="recovery"
          onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } }}
          className="block w-full bg-card border rounded-xl px-4 py-3 text-sm hover:border-primary/50 transition-colors"
        >
          <div className="flex items-center gap-2 font-medium">
            <KeyRound className="w-4 h-4 text-primary" /> Maak nu een herstelcode aan
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Aanbevolen. Eén keer opslaan en je kunt later op een nieuw apparaat
            opnieuw inloggen.
          </p>
        </Link>
      </div>
    </div>
  );
}
