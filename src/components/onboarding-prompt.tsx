import { useEffect, useState } from "react";
import { Bell, Download, Share, X, Plus, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  detectIOSSafari,
  getDeferredInstall,
  installDismissedRecently,
  isAppInstalled,
  markInstallDismissed,
  promptInstall,
  subscribeInstallChange,
} from "@/lib/install-prompt";
import {
  getPushStatus,
  hasAskedPushPermission,
  isSubscribed,
  markPushPermissionAsked,
  pushSupported,
  subscribePush,
} from "@/lib/push";
import { toast } from "sonner";

type Stage = "hidden" | "install-android" | "install-ios" | "push";

/**
 * Gecombineerde onboarding-kaart: eerst installeren, daarna meldingen.
 * - Op iOS Safari worden meldingen pas voorgesteld zodra de app als PWA draait.
 * - Niet-blokkerend, weg te klikken, en wordt niet bij elke sessie herhaald.
 */
export function OnboardingPrompt({ userId }: { userId: string }) {
  const [stage, setStage] = useState<Stage>("hidden");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function decide() {
      if (cancelled) return;
      const standalone = isAppInstalled();
      const ios = detectIOSSafari();

      // Stap 1: installatie aanbieden indien (nog) niet geïnstalleerd.
      if (!standalone) {
        if (installDismissedRecently()) return; // niet bij elke sessie pushen
        if (ios) {
          setStage("install-ios");
          return;
        }
        if (getDeferredInstall()) {
          setStage("install-android");
          return;
        }
        // Wacht passief op een laat-aankomend beforeinstallprompt-event.
        return;
      }

      // Stap 2: meldingen aanbieden (alleen ná installatie).
      if (!pushSupported()) return;
      if (hasAskedPushPermission()) return;
      const status = await getPushStatus();
      if (status !== "default") return;
      if (await isSubscribed()) return;
      setStage("push");
    }

    // Wacht een tel zodat onboarding niet meteen bij eerste pixel verschijnt.
    timer = setTimeout(decide, 1200);
    const unsub = subscribeInstallChange(() => void decide());

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  if (stage === "hidden") return null;

  function dismissInstall() {
    markInstallDismissed();
    setStage("hidden");
  }

  function dismissPush() {
    markPushPermissionAsked();
    setStage("hidden");
  }

  async function handleInstall() {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === "accepted") {
      // appinstalled-event triggert vanzelf de push-stap zodra standalone.
      setStage("hidden");
    } else if (outcome === "dismissed" || outcome === "unavailable") {
      markInstallDismissed();
      setStage("hidden");
    }
  }

  async function handleEnablePush() {
    setBusy(true);
    markPushPermissionAsked();
    const ok = await subscribePush(userId);
    setBusy(false);
    if (ok) toast.success("Meldingen aan");
    else toast.error("Meldingen niet ingeschakeld");
    setStage("hidden");
  }

  return (
    <div className="mx-3 mt-3 rounded-xl border bg-card p-3 shadow-sm">
      {stage === "install-android" && (
        <Body
          icon={<Download className="w-4 h-4" />}
          title="Installeer valvora"
          text="Voor de beste ervaring (en om meldingen te kunnen ontvangen): zet de app op je startscherm."
          onClose={dismissInstall}
        >
          <Button size="sm" disabled={busy} onClick={handleInstall}>
            Installeren
          </Button>
          <Button size="sm" variant="ghost" onClick={dismissInstall}>
            Niet nu
          </Button>
        </Body>
      )}

      {stage === "install-ios" && (
        <Body
          icon={<Smartphone className="w-4 h-4" />}
          title="Zet op beginscherm"
          text="Op iPhone werkt dit als app na het toevoegen aan je beginscherm. Tik op het deel-icoon onderin Safari en kies 'Zet op beginscherm'."
          onClose={dismissInstall}
        >
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Share className="w-4 h-4" />
            <span>→</span>
            <Plus className="w-4 h-4" />
            <span className="ml-1">Zet op beginscherm</span>
          </div>
          <Button size="sm" variant="ghost" onClick={dismissInstall}>
            Begrepen
          </Button>
        </Body>
      )}

      {stage === "push" && (
        <Body
          icon={<Bell className="w-4 h-4" />}
          title="Meldingen aanzetten?"
          text='Je krijgt alleen een seintje "Nieuw bericht" — de inhoud blijft versleuteld en wordt pas in de app ontsleuteld.'
          onClose={dismissPush}
        >
          <Button size="sm" disabled={busy} onClick={handleEnablePush}>
            Aanzetten
          </Button>
          <Button size="sm" variant="ghost" onClick={dismissPush}>
            Niet nu
          </Button>
        </Body>
      )}
    </div>
  );
}

function Body({
  icon,
  title,
  text,
  children,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 text-sm">
        <div className="font-medium">{title}</div>
        <p className="text-muted-foreground text-xs mt-0.5">{text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
      </div>
      <button
        aria-label="Sluiten"
        onClick={onClose}
        className="p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
