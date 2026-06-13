import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ensureKeyPair } from "@/lib/ensure-keys";
import { sodiumReady } from "@/lib/crypto";
import { takePendingInvite } from "@/lib/pending-invite";
import { joinByInvite } from "@/lib/contacts.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const join = useServerFn(joinByInvite);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await sodiumReady();
      try {
        await ensureKeyPair(user.id);
      } catch (e) {
        console.error("ensureKeyPair", e);
      }
      if (cancelled) return;
      setReady(true);

      // Consume pending invite from /join → /auth → here
      const pending = takePendingInvite();
      if (pending) {
        try {
          const result = await join({ data: { token: pending } });
          if (!result.self) {
            toast.success("Contact toegevoegd");
            nav({ to: "/chats" });
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Toevoegen mislukt";
          toast.error(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, join, nav]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-sm">
        Sleutels laden…
      </div>
    );
  }
  return <Outlet />;
}
