import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { parseRecoveryCode, decryptRecoveryBlob } from "@/lib/recovery";
import { fetchRecoveryByLookup } from "@/lib/recovery.functions";
import { savePrivateKey } from "@/lib/local-key-store";

export const Route = createFileRoute("/recover")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/chats" });
  },
  component: RecoverPage,
});

function RecoverPage() {
  const nav = useNavigate();
  const fetchBlob = useServerFn(fetchRecoveryByLookup);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseRecoveryCode(code);
    if (!parsed) {
      setError("Code klopt niet. Een herstelcode bestaat uit 30 tekens (zes blokken van vijf).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchBlob({ data: { recovery_id: parsed.recoveryId } });
      // Generic error to avoid leaking existence.
      if (!res.found) {
        setError("Deze herstelcode werkt niet. Controleer of je hem letter voor letter goed hebt overgenomen.");
        return;
      }
      let payload;
      try {
        payload = await decryptRecoveryBlob(code, res.blob);
      } catch {
        setError("Deze herstelcode werkt niet. Controleer of je hem letter voor letter goed hebt overgenomen.");
        return;
      }

      // Restore the Supabase session for the original user.
      const { error: sessErr } = await supabase.auth.setSession({
        access_token: payload.access_token ?? payload.refresh_token,
        refresh_token: payload.refresh_token,
      });
      if (sessErr) {
        // Often: refresh token expired or rotated past the backup. Tell honestly.
        setError(
          "Je code klopt, maar de sessie kon niet hersteld worden. Dat gebeurt als de code te oud is. Vraag een lid je opnieuw uit te nodigen.",
        );
        return;
      }

      // Put the private key back on this device.
      await savePrivateKey(payload.user_id, payload.private_key);

      toast.success("Account hersteld");
      nav({ to: "/chats" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Herstellen mislukt";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="px-2 py-3 flex items-center gap-2">
        <Link to="/auth" className="p-2 rounded-full hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold">Account herstellen</h1>
      </header>
      <main className="flex-1 flex items-start justify-center px-4 py-6">
        <form onSubmit={submit} className="w-full max-w-sm bg-card border rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="w-4 h-4 text-primary" /> Voer je herstelcode in
          </div>
          <p className="text-xs text-muted-foreground">
            Plak de code die je destijds bij het aanmaken hebt opgeslagen.
            Hoofdletters of kleine letters maakt niet uit; streepjes mogen je
            overslaan.
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono tracking-wider"
          />
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">{error}</div>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Bezig…" : "Herstel mijn account"}
          </Button>
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              De code blijft op dit apparaat. We sturen 'm niet naar de server —
              ontsleutelen gebeurt hier in je browser.
            </span>
          </div>
        </form>
      </main>
    </div>
  );
}
