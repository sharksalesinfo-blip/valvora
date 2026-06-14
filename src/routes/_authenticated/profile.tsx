import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ShieldCheck, Copy, Bell, QrCode, Link2, RefreshCw, AtSign, Share2, LogOut, Camera, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { toast } from "sonner";
import { publicKeyFingerprint } from "@/lib/crypto";
import { KeyQrCode } from "@/components/key-qr-code";
import { AvatarCircle } from "@/components/avatar-circle";
import { invalidateAvatarCache } from "@/lib/avatar-url";
import { getMyInvite, rotateInvite, setHandle } from "@/lib/contacts.functions";
import { buildInviteUrl } from "@/lib/pending-invite";
import { detectIOSSafari, isAppInstalled } from "@/lib/install-prompt";
import {
  getPushStatus,
  isSubscribed,
  pushSupported,
  subscribePush,
  unsubscribePush,
} from "@/lib/push";
import { RecoverySection } from "@/components/recovery-section";
import { getMyRecoveryStatus } from "@/lib/recovery.functions";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

async function cropToSquareJpeg(file: File, size = 512): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const min = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - min) / 2;
  const sy = (bmp.height - min) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, sx, sy, min, min, 0, 0, size, size);
  return await new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b!), "image/jpeg", 0.88)!,
  );
}

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [handle, setHandleLocal] = useState("");
  const [savedHandle, setSavedHandle] = useState<string | null>(null);
  const [fp, setFp] = useState<string>("");
  const [pk, setPk] = useState<string>("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [handleBusy, setHandleBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushAvail, setPushAvail] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recoveryEnabled, setRecoveryEnabled] = useState<boolean | null>(null);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState<boolean>(true);
  const [readReceiptsBusy, setReadReceiptsBusy] = useState(false);
  const fetchRecovery = useServerFn(getMyRecoveryStatus);


  const fetchInvite = useServerFn(getMyInvite);
  const callRotate = useServerFn(rotateInvite);
  const callSetHandle = useServerFn(setHandle);

  useEffect(() => {
    setPushAvail(pushSupported());
    // iOS-in-browser kan geen push ontvangen: alleen geïnstalleerde PWA wel.
    if (typeof window !== "undefined") {
      const ios = detectIOSSafari();
      if (ios && !isAppInstalled()) {
        setPushNote("Op iPhone werkt push alleen nadat je de app via Safari aan je beginscherm toevoegt.");
      }
    }
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

  async function toggleReadReceipts(on: boolean) {
    setReadReceiptsBusy(true);
    const prev = readReceiptsEnabled;
    setReadReceiptsEnabled(on);
    const { error } = await supabase
      .from("profiles")
      .update({ read_receipts_enabled: on })
      .eq("id", user.id);
    setReadReceiptsBusy(false);
    if (error) {
      setReadReceiptsEnabled(prev);
      toast.error(error.message);
    }
  }


  useEffect(() => {
    supabase
      .from("profiles")
      .select("display_name, public_key, key_fingerprint, handle, avatar_url, read_receipts_enabled")

      .eq("id", user.id)
      .single()
      .then(async ({ data }) => {
        if (data) {
          setName(data.display_name);
          setHandleLocal(data.handle ?? "");
          setSavedHandle(data.handle ?? null);
          setPk(data.public_key ?? "");
          setAvatarPath(data.avatar_url ?? null);
          setReadReceiptsEnabled(data.read_receipts_enabled ?? true);
          setFp(data.key_fingerprint ?? (data.public_key ? await publicKeyFingerprint(data.public_key) : ""));
        }

      });
    void fetchInvite().then((r) => setInviteToken(r.token)).catch(() => undefined);
    void fetchRecovery().then((s) => setRecoveryEnabled(s.enabled)).catch(() => setRecoveryEnabled(false));
  }, [user.id, fetchInvite, fetchRecovery]);

  async function save() {
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", user.id);
    if (error) toast.error(error.message);
    else toast.success("Opgeslagen");
  }

  async function saveHandle() {
    setHandleBusy(true);
    try {
      const r = await callSetHandle({ data: { handle } });
      setSavedHandle(r.handle);
      setHandleLocal(r.handle);
      toast.success("Handle opgeslagen");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Opslaan mislukt";
      toast.error(msg);
    } finally {
      setHandleBusy(false);
    }
  }

  async function rotateInviteLink() {
    if (!confirm("Maak een nieuwe invite-link aan? De oude werkt daarna niet meer.")) return;
    setInviteBusy(true);
    try {
      const r = await callRotate();
      setInviteToken(r.token);
      toast.success("Nieuwe invite-link aangemaakt");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Vernieuwen mislukt";
      toast.error(msg);
    } finally {
      setInviteBusy(false);
    }
  }

  async function onPickAvatar(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Kies een afbeelding");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES * 4) {
      toast.error("Afbeelding te groot");
      return;
    }
    setAvatarBusy(true);
    try {
      const blob = await cropToSquareJpeg(file, 512);
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      // Verwijder eventuele oude avatar (best-effort)
      if (avatarPath && avatarPath !== path) {
        void supabase.storage.from("avatars").remove([avatarPath]);
        invalidateAvatarCache(avatarPath);
      }
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (updErr) throw updErr;
      setAvatarPath(path);
      toast.success("Avatar bijgewerkt");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload mislukt";
      toast.error(msg);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    if (!avatarPath) return;
    setAvatarBusy(true);
    try {
      await supabase.storage.from("avatars").remove([avatarPath]);
      await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
      invalidateAvatarCache(avatarPath);
      setAvatarPath(null);
      toast.success("Avatar verwijderd");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verwijderen mislukt";
      toast.error(msg);
    } finally {
      setAvatarBusy(false);
    }
  }

  const inviteUrl = inviteToken ? buildInviteUrl(inviteToken) : "";

  async function shareInvite() {
    if (!inviteUrl) return;
    const text = `Voeg me toe op valvora: ${inviteUrl}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Uitnodiging", text, url: inviteUrl });
        return;
      } catch {
        // user cancelled — fall through
      }
    }
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Link gekopieerd");
  }

  async function logout() {
    // Belangrijk: we wissen de lokale privésleutel NIET. Die hoort bij dit
    // apparaat en moet bij opnieuw inloggen meteen weer werken.
    await supabase.auth.signOut();
    toast.success("Uitgelogd");
    nav({ to: "/auth" });
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="bg-header text-header-foreground px-2 py-3 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/chats" className="p-2 rounded-full hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-lg font-semibold">Profiel</h1>
      </header>
      <main className="p-4 space-y-6 max-w-md mx-auto w-full">
        <section className="flex items-center gap-4">
          <div className="relative">
            <AvatarCircle name={name || "?"} avatarUrl={avatarPath} size={72} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground rounded-full p-1.5 shadow-md disabled:opacity-50"
              aria-label="Avatar wijzigen"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickAvatar(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-muted-foreground">Avatar</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Wordt vierkant bijgesneden. Alleen ingelogde gebruikers binnen je kring zien hem.
            </p>
            {avatarPath && (
              <button
                type="button"
                onClick={removeAvatar}
                disabled={avatarBusy}
                className="text-xs underline text-muted-foreground mt-1"
              >
                Verwijderen
              </button>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <label className="text-sm font-medium">Weergavenaam</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={save}>Opslaan</Button>
        </section>

        <section className="bg-card border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AtSign className="w-4 h-4 text-primary" /> Handle
          </div>
          <p className="text-xs text-muted-foreground">
            Een unieke naam waarmee mensen je kunnen vinden, bijvoorbeeld als de
            invite-link niet bij de hand is. 3–20 tekens: letters, cijfers of _.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
              <Input
                value={handle}
                onChange={(e) => setHandleLocal(e.target.value.replace(/^@/, ""))}
                placeholder="jouwnaam"
                className="pl-7"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <Button onClick={saveHandle} disabled={handleBusy || !handle || handle === savedHandle}>
              {handleBusy ? "Bezig…" : "Opslaan"}
            </Button>
          </div>
        </section>

        <section className="bg-card border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="w-4 h-4 text-primary" /> Jouw invite-link
          </div>
          <p className="text-xs text-muted-foreground">
            Iedereen die deze link opent en is ingelogd, wordt direct als contact
            toegevoegd. Deel hem alleen met mensen die je wilt toelaten.
          </p>
          <div className="font-mono text-xs break-all bg-muted rounded-md p-3">
            {inviteUrl || "(bezig met laden…)"}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={shareInvite} disabled={!inviteUrl} size="sm">
              <Share2 className="w-4 h-4 mr-1" /> Delen
            </Button>
            <Button
              onClick={() => {
                if (!inviteUrl) return;
                void navigator.clipboard.writeText(inviteUrl);
                toast.success("Gekopieerd");
              }}
              disabled={!inviteUrl}
              size="sm"
              variant="outline"
            >
              <Copy className="w-4 h-4 mr-1" /> Kopiëren
            </Button>
            <Button onClick={rotateInviteLink} disabled={inviteBusy} size="sm" variant="outline">
              <RefreshCw className="w-4 h-4 mr-1" /> Vernieuwen
            </Button>
          </div>
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

        <RecoverySection userId={user.id} />

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
          {pushNote && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{pushNote}</p>
          )}
        </section>

        <section className="bg-card border rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCheck className="w-4 h-4 text-primary" /> Leesbevestigingen
            </div>
            <Switch
              checked={readReceiptsEnabled}
              disabled={readReceiptsBusy}
              onCheckedChange={(v) => void toggleReadReceipts(v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Blauwe vinkjes voor "gelezen". Wederkerig: zet je dit uit, dan stuurt
            jouw app geen leesbevestigingen meer én zie je ook geen blauwe vinkjes
            van anderen. Verstuurd en afgeleverd (één en twee grijze vinkjes)
            blijven altijd zichtbaar.
          </p>
        </section>


        <section className="text-xs text-muted-foreground space-y-1">
          <p>📱 Je privésleutel staat alleen op dit apparaat (IndexedDB).</p>
          <p>🔒 De server slaat alleen versleutelde berichten op.</p>
          <p>🔔 Pushmeldingen bevatten nooit berichtinhoud.</p>
        </section>

        <section className="pt-8 mt-4 border-t">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="w-full justify-center">
                <LogOut className="w-4 h-4 mr-2" /> Uitloggen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Weet je zeker dat je wilt uitloggen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Je privésleutel blijft op dit apparaat bewaard, dus je kunt later
                  weer inloggen en je berichten lezen.
                  {recoveryEnabled === false && (
                    <span className="block mt-2 text-amber-600 dark:text-amber-400">
                      ⚠️ Je hebt geen herstelcode aangemaakt. Als je je
                      browsergegevens wist of dit apparaat verliest, ben je je
                      account kwijt.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuleren</AlertDialogCancel>
                <AlertDialogAction onClick={() => void logout()}>Uitloggen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </main>
    </div>
  );
}
