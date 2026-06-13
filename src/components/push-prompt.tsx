import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getPushStatus,
  hasAskedPushPermission,
  isSubscribed,
  markPushPermissionAsked,
  pushSupported,
  subscribePush,
} from "@/lib/push";
import { toast } from "sonner";

export function PushPrompt({ userId }: { userId: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      if (!pushSupported()) return;
      if (hasAskedPushPermission()) return;
      const status = await getPushStatus();
      if (status !== "default") return;
      if (await isSubscribed()) return;
      setShow(true);
    })();
  }, []);

  if (!show) return null;

  return (
    <div className="mx-3 mt-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Bell className="w-4 h-4" />
        </div>
        <div className="flex-1 text-sm">
          <div className="font-medium">Meldingen aanzetten?</div>
          <p className="text-muted-foreground text-xs mt-0.5">
            Je krijgt alleen een seintje "Nieuw bericht" — de inhoud blijft versleuteld en
            wordt pas in de app ontsleuteld.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                markPushPermissionAsked();
                const ok = await subscribePush(userId);
                if (ok) toast.success("Meldingen aan");
                else toast.error("Meldingen niet ingeschakeld");
                setShow(false);
              }}
            >
              Aanzetten
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { markPushPermissionAsked(); setShow(false); }}
            >
              Niet nu
            </Button>
          </div>
        </div>
        <button
          aria-label="Sluiten"
          onClick={() => { markPushPermissionAsked(); setShow(false); }}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
