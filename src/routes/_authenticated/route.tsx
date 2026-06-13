import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ensureKeyPair } from "@/lib/ensure-keys";
import { sodiumReady } from "@/lib/crypto";

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
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-sm">
        Sleutels laden…
      </div>
    );
  }
  return <Outlet />;
}
