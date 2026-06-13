import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ShieldCheck, Copy, Bell, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { publicKeyFingerprint } from "@/lib/crypto";
import { KeyQrCode } from "@/components/key-qr-code";
import {
  getPushStatus,
  isSubscribed,
  pushSupported,
  subscribePush,
  unsubscribePush,
} from "@/lib/push";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const [name, setName] = useState("");
  const [fp, setFp] = useState<string>("");
  const [pk, setPk] = useState<string>("");
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushAvail, setPushAvail] = useState(false);

  useEffect(() => {
    setPushAvail(pushSupported());
    (async () => {
      if (!pushSupported()) return;
      const status = await getPushStatus();
      setPushOn(status === "granted" && (await isSubscribed()));
    })();
  }, []);

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) {
        const ok = await subscribePush(user.id);
        setPushOn(ok);
        if (!ok) toast.error("Meldingen niet ingeschakeld");
      } else {
        await unsubscribePush();
        setPushOn(false);
      }
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    supabase
      .from("profiles")
      .select("display_name, public_key, key_fingerprint")
      .eq("id", user.id)
      .single()
      .then(async ({ data }) => {
        if (data) {
          setName(data.display_name);
          setPk(data.public_key ?? "");
          setFp(data.key_fingerprint ?? (data.public_key ? await publicKeyFingerprint(data.public_key) : ""));
        }
      });
  }, [user.id]);

  async function save() {
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", user.id);
    if (error) toast.error(error.message);
    else toast.success("Opgeslagen");
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-3 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/chats" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-lg font-semibold">Profiel</h1>
      </header>
      <main className="p-4 space-y-6 max-w-md mx-auto w-full">
        <section className="space-y-2">
          <label className="text-sm font-medium">Weergavenaam</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={save}>Opslaan</Button>
        </section>

        <section className="bg-card border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <QrCode className="w-4 h-4 text-primary" /> Jouw verificatie-QR
          </div>
          <p className="text-xs text-muted-foreground">
            Laat een gesprekspartner deze code scannen om zijn/haar app te laten
            bevestigen dat ze met jouw échte sleutel praten. De vergelijking
            gebeurt alleen op het andere toestel — niets gaat via de server.
          </p>
          <div className="flex justify-center">
            {pk ? <KeyQrCode userId={user.id} publicKey={pk} /> : <div className="text-xs text-muted-foreground">(geen sleutel)</div>}
          </div>
        </section>

        <section className="bg-card border rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="w-4 h-4 text-primary" /> Sleutel-fingerprint (fallback)
          </div>
          <p className="text-xs text-muted-foreground">
            Kan iemand niet scannen? Lees deze code samen voor (telefoon of in persoon)
            om te bevestigen dat je met de juiste sleutel praat.
          </p>
          <div className="font-mono text-sm break-all bg-muted rounded-md p-3">
            {fp || "(geen sleutel)"}
          </div>
          {fp && (
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(fp); toast.success("Gekopieerd"); }}>
              <Copy className="w-4 h-4 mr-1" /> Kopiëren
            </Button>
          )}
        </section>

        <section className="bg-card border rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bell className="w-4 h-4 text-primary" /> Pushmeldingen
            </div>
            <Switch
              checked={pushOn}
              disabled={!pushAvail || pushBusy}
              onCheckedChange={(v) => void togglePush(v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Je krijgt alleen een seintje "Nieuw bericht". Berichtinhoud blijft versleuteld en
            wordt pas in de app ontsleuteld.
            {!pushAvail && " (Niet ondersteund op dit apparaat)"}
          </p>
        </section>

        <section className="text-xs text-muted-foreground space-y-1">
          <p>📱 Je privésleutel staat alleen op dit apparaat (IndexedDB).</p>
          <p>🔒 De server slaat alleen versleutelde berichten op.</p>
          <p>🔔 Pushmeldingen bevatten nooit berichtinhoud.</p>
        </section>
      </main>
    </div>
  );
}
