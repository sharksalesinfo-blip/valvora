import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, UserPlus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { rememberPendingInvite } from "@/lib/pending-invite";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/chats" });
  },
  component: AuthPage,
});

function extractInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code && UUID_RE.test(code)) return code;
  } catch {
    // not a URL
  }
  return null;
}

function AuthPage() {
  const nav = useNavigate();
  const [inviteInput, setInviteInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function useInvite(e: React.FormEvent) {
    e.preventDefault();
    const token = extractInviteToken(inviteInput);
    if (!token) {
      toast.error("Plak een geldige invite-link of code");
      return;
    }
    setBusy(true);
    rememberPendingInvite(token);
    nav({ to: "/join", search: { code: token } });
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <img src="/icon-192.png" alt="valvora" className="mx-auto w-16 h-16 rounded-2xl mb-3 shadow-sm" />
          <h1 className="text-2xl font-semibold tracking-tight">valvora</h1>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mt-1">
            versleuteld · besloten
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            Geen e-mail, geen wachtwoord. Je komt binnen via een uitnodiging
            van iemand die al lid is.
          </p>
        </div>

        <form onSubmit={useInvite} className="bg-card border rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="w-4 h-4 text-primary" /> Heb je een uitnodiging?
          </div>
          <p className="text-xs text-muted-foreground">
            Plak de link of code die je hebt ontvangen. Of open de link direct
            uit je bericht — dan ben je in één tik binnen.
          </p>
          <Input
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            placeholder="https://… of de code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={busy} className="w-full">
            Doorgaan met deze uitnodiging
          </Button>
        </form>

        <Link
          to="/recover"
          className="block bg-card border rounded-2xl p-5 shadow-sm space-y-2 hover:border-primary/50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="w-4 h-4 text-primary" /> Account herstellen
          </div>
          <p className="text-xs text-muted-foreground">
            Heb je eerder een herstelcode aangemaakt en gebruik je nu een nieuw
            apparaat? Voer hem in om weer toegang te krijgen.
          </p>
        </Link>

        <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          End-to-end versleuteld. Alleen jij en je gesprekspartner lezen mee.
        </div>
      </div>
    </div>
  );
}
