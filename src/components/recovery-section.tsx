import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { KeyRound, Copy, ShieldCheck, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import {
  generateRecoveryCode,
  formatRecoveryCode,
  encryptRecoveryPayload,
} from "@/lib/recovery";

import { loadPrivateKey } from "@/lib/local-key-store";
import { supabase } from "@/integrations/supabase/client";
import {
  getMyRecoveryStatus,
  saveMyRecovery,
  disableMyRecovery,
} from "@/lib/recovery.functions";

export function RecoverySection({ userId }: { userId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const fetchStatus = useServerFn(getMyRecoveryStatus);
  const save = useServerFn(saveMyRecovery);
  const disable = useServerFn(disableMyRecovery);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#recovery") {
      setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }, []);

  useEffect(() => {
    void fetchStatus().then((s) => {
      setEnabled(s.enabled);
      setUpdatedAt(s.updated_at);
    });
  }, [fetchStatus]);

  async function createCode() {
    setBusy(true);
    try {
      const priv = await loadPrivateKey(userId);
      if (!priv) throw new Error("Geen privésleutel op dit apparaat gevonden");
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Geen actieve sessie");
      const code = await generateRecoveryCode();
      const { blob } = await encryptRecoveryPayload(code, {
        v: 1,
        user_id: userId,
        private_key: priv,
        refresh_token: data.session.refresh_token,
        access_token: data.session.access_token,
      });
      await save({ data: blob });

      setShownCode(formatRecoveryCode(code));
      setAcknowledged(false);
      setEnabled(true);
      setUpdatedAt(new Date().toISOString());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function disableRecovery() {
    setBusy(true);
    try {
      await disable();
      setEnabled(false);
      setUpdatedAt(null);

      toast.success("Herstelcode uitgeschakeld");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Uitschakelen mislukt");
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!shownCode) return;
    void navigator.clipboard.writeText(shownCode);
    toast.success("Gekopieerd");
  }

  function closeShown() {
    setShownCode(null);
  }

  return (
    <section ref={ref} id="recovery" className="bg-card border rounded-xl p-4 space-y-3 scroll-mt-20">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="w-4 h-4 text-primary" /> Accountherstel
      </div>

      {shownCode ? (
        <div className="space-y-3">
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4" /> Bewaar deze code nu meteen
            </div>
            <p className="text-xs text-amber-900 dark:text-amber-100">
              We tonen 'm <strong>één keer</strong>. Bewaar 'm in een
              wachtwoordmanager of schrijf 'm op. Met deze code log je later op
              een ander apparaat in. Verlies je 'm, dan kan niemand — ook wij
              niet — je account herstellen.
            </p>
          </div>
          <div className="font-mono text-center text-base tracking-wider bg-muted rounded-md p-4 select-all break-all">
            {shownCode}
          </div>
          <div className="flex gap-2">
            <Button onClick={copyCode} variant="outline" size="sm">
              <Copy className="w-4 h-4 mr-1" /> Kopiëren
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span>Ik heb de code op een veilige plek opgeslagen.</span>
          </label>
          <Button
            onClick={closeShown}
            disabled={!acknowledged}
            className="w-full"
            size="sm"
          >
            <Check className="w-4 h-4 mr-1" /> Klaar
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Zonder herstelcode bestaat je account alleen op dit apparaat. Wis je
            je browsergegevens of raak je dit toestel kwijt, dan ben je je
            identiteit én berichtgeschiedenis kwijt. Met een herstelcode kun je
            op een nieuw apparaat opnieuw inloggen met dezelfde identiteit.
            <br /><br />
            <em className="not-italic text-muted-foreground/80">
              Let op: de code herstelt je identiteit en je contacten — niet je
              oude berichten als die alleen op het verloren apparaat stonden.
            </em>
          </p>

          {enabled === true && (
            <div className="rounded-md bg-primary/10 text-primary text-sm p-3 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 mt-0.5" />
              <div>
                <div className="font-medium">Herstelcode actief</div>
                <div className="text-xs opacity-80">
                  Laatst bijgewerkt: {updatedAt ? new Date(updatedAt).toLocaleDateString("nl-NL") : "onbekend"}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={busy}>
                  {enabled ? "Nieuwe code aanmaken" : "Herstelcode aanmaken"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {enabled ? "Code vervangen?" : "Herstelcode aanmaken"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    We genereren een nieuwe code in je browser en versleutelen
                    daarmee een kopie van je sleutel. De code zelf gaat
                    <strong> nooit </strong> naar de server.
                    {enabled && " Een eventuele oude code werkt daarna niet meer."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuleren</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void createCode()}>
                    Aanmaken
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {enabled && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={busy}>
                    Uitschakelen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Herstelcode uitschakelen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      We verwijderen de versleutelde back-up van de server. Als
                      je dit apparaat verliest, kun je je account niet meer
                      herstellen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuleren</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void disableRecovery()}>
                      Uitschakelen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </>
      )}
    </section>
  );
}
