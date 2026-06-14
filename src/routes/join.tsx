import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { joinByInvite, lookupInvite } from "@/lib/contacts.functions";
import { rememberPendingInvite } from "@/lib/pending-invite";
import { Button } from "@/components/ui/button";
import { Lock, UserPlus, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";

const searchSchema = z.object({
  code: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/join")({
  ssr: false,
  validateSearch: zodValidator(searchSchema),
  component: JoinPage,
});

type State =
  | { kind: "loading"; label: string }
  | { kind: "missing" }
  | { kind: "added"; name: string; userId: string }
  | { kind: "self" }
  | { kind: "error"; message: string };

function JoinPage() {
  const { code } = Route.useSearch();
  const nav = useNavigate();
  const join = useServerFn(joinByInvite);
  const lookup = useServerFn(lookupInvite);
  const [state, setState] = useState<State>({ kind: "loading", label: "Even kijken…" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!code) {
        setState({ kind: "missing" });
        return;
      }
      rememberPendingInvite(code);

      // Sign in anonymously if there's no session yet. New users don't need
      // anything beyond the invite link.
      let { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        if (!cancelled) setState({ kind: "loading", label: "Account aanmaken…" });
        const { error } = await supabase.auth.signInAnonymously();
        if (error) {
          if (!cancelled) setState({ kind: "error", message: "Aanmelden lukte niet. Probeer het opnieuw." });
          return;
        }
        ({ data: sess } = await supabase.auth.getSession());
        if (!sess.session) {
          if (!cancelled) setState({ kind: "error", message: "Aanmelden lukte niet. Probeer het opnieuw." });
          return;
        }
      }

      try {
        if (!cancelled) setState({ kind: "loading", label: "Contact koppelen…" });
        const info = await lookup({ data: { token: code } });
        if (!info.found) {
          if (!cancelled) setState({ kind: "error", message: "Deze invite-link werkt niet meer." });
          return;
        }
        const result = await join({ data: { token: code } });
        if (cancelled) return;
        if (result.self) {
          setState({ kind: "self" });
        } else {
          // Forward to the app — onboarding (name + recovery prompt) lives there.
          nav({ to: "/chats" });
          setState({ kind: "added", name: info.display_name, userId: info.user_id });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Toevoegen mislukt";
        if (!cancelled) setState({ kind: "error", message: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, join, lookup, nav]);

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-card border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-2">
            <UserPlus className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold">Uitnodiging</h1>
        </div>

        {state.kind === "loading" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> {state.label}
          </div>
        )}

        {state.kind === "missing" && (
          <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>Er staat geen uitnodigingscode in de link.</div>
          </div>
        )}

        {state.kind === "added" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-primary/10 text-primary p-3 text-sm">
              <ShieldCheck className="w-5 h-5 mt-0.5" />
              <div>
                <div className="font-medium">{state.name} is toegevoegd</div>
                <div>Je staan nu over en weer in elkaars contactenlijst.</div>
              </div>
            </div>
            <Button className="w-full" onClick={() => nav({ to: "/chats" })}>
              Naar gesprekken
            </Button>
          </div>
        )}

        {state.kind === "self" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Dit is je eigen invite-link.
            </p>
            <Button className="w-full" onClick={() => nav({ to: "/chats" })}>
              Naar gesprekken
            </Button>
          </div>
        )}

        {state.kind === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3 text-sm">
              <Lock className="w-5 h-5 mt-0.5" />
              <div>{state.message}</div>
            </div>
            <Link to="/auth" className="block text-center text-sm text-muted-foreground hover:text-foreground">
              Terug
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
