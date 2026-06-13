import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/chats" });
  },
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name || email.split("@")[0] },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Account aangemaakt. Je bent ingelogd.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav({ to: "/chats" });
    } catch (err: any) {
      toast.error(err?.message ?? "Er ging iets mis");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-semibold">Versleutelde Chat</h1>
          <p className="text-sm text-muted-foreground mt-1">End-to-end versleuteld. Alleen jij en de ontvanger lezen mee.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 bg-card border rounded-2xl p-6 shadow-sm">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Weergavenaam</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bv. Anna" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Wachtwoord</Label>
            <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Bezig…" : mode === "login" ? "Inloggen" : "Account aanmaken"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="block mx-auto mt-4 text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "login" ? "Nog geen account? Registreren" : "Heb al een account? Inloggen"}
        </button>
      </div>
    </div>
  );
}
