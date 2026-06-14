import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { registerPushWorker } from "@/lib/pwa";
// Eager import zorgt dat de `beforeinstallprompt`-listener al klaarstaat
// vóórdat React de eerste route mount — anders mist Chrome het event en
// werkt de "Installeren"-knop nooit.
import "@/lib/install-prompt";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Deze pagina bestaat niet.</p>
        <a href="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Naar de chats</a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Er ging iets mis</h1>
        <p className="mt-2 text-sm text-muted-foreground">Probeer het opnieuw of ga terug naar de chats.</p>
        <div className="mt-6 flex gap-2 justify-center">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Opnieuw</button>
          <a href="/" className="rounded-md border px-4 py-2 text-sm">Naar de chats</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0E1B2A" },
      { title: "valvora — versleuteld · besloten" },
      { name: "description", content: "valvora — end-to-end versleutelde chat voor je eigen kring." },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "valvora" },
      { name: "twitter:title", content: "valvora" },
      { property: "og:description", content: "End-to-end versleutelde chat voor je eigen kring." },
      { name: "twitter:description", content: "End-to-end versleutelde chat voor je eigen kring." },
      { property: "og:image", content: "https://valvora.nl/__l5e/assets-v1/80742bff-3a62-4a01-b29c-83c25fe80521/valvora-og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "valvora — versleuteld · besloten" },
      { name: "twitter:image", content: "https://valvora.nl/__l5e/assets-v1/80742bff-3a62-4a01-b29c-83c25fe80521/valvora-og.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "valvora" },
      { property: "og:url", content: "https://valvora.nl" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/svg+xml", href: "/valvora-icon.svg" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "canonical", href: "https://valvora.nl" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    void registerPushWorker();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session) {
        void rotateRecoveryIfPossible(session);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}

async function rotateRecoveryIfPossible(session: { user: { id: string }; access_token: string; refresh_token: string }) {
  try {
    const { loadRecoveryWrapKey, reencryptRecoveryPayload } = await import("@/lib/recovery");
    const cached = await loadRecoveryWrapKey(session.user.id);
    if (!cached) return;
    const { loadPrivateKey } = await import("@/lib/local-key-store");
    const priv = await loadPrivateKey(session.user.id);
    if (!priv) return;
    const { ciphertext, nonce } = await reencryptRecoveryPayload(cached.key, {
      v: 1,
      user_id: session.user.id,
      private_key: priv,
      refresh_token: session.refresh_token,
      access_token: session.access_token,
    });
    const { rotateMyRecoveryCiphertext } = await import("@/lib/recovery.functions");
    await rotateMyRecoveryCiphertext({ data: { ciphertext, nonce } });
  } catch (e) {
    console.warn("recovery rotation skipped", e);
  }
}
