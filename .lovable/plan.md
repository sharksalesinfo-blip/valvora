# Twee aparte fixes: realtime updates + VAPID-keypair

## Probleem 1 — In-app: berichten verschijnen pas na navigeren

### Diagnose
`chats.tsx` en `chat.$id.tsx` hebben realtime-listeners op `postgres_changes` voor `messages` en `conversation_members`. Code is bedraad, dus events komen óf niet binnen óf de listener subscribet niet succesvol. Drie mogelijke oorzaken, te controleren in deze volgorde:

1. **Realtime publication** staat niet aan voor de betrokken tabellen. Postgres' logische replicatie stuurt alleen events voor tabellen in `supabase_realtime` publication. Check: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`. Als `messages` / `conversation_members` ontbreken → toevoegen via migratie: `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages, public.conversation_members`.

2. **Subscribe-status** wordt nu niet gelogd. Toevoegen: `.subscribe((status) => console.log("realtime", status))` in beide kanalen — zo zien we direct `SUBSCRIBED` of een fout. Tijdelijk voor diagnose, of permanent als debug-only.

3. **RLS-pad voor realtime**. Realtime evalueert RLS als de ingelogde gebruiker. Als `messages` SELECT-policy via een complexe join op `conversation_members` loopt, kan het event afgewezen worden. Lossen we alleen op als 1 en 2 niet de oorzaak zijn.

### Stappen
- Stap A: query `pg_publication_tables`, kijk welke tabellen erin zitten.
- Stap B: als `messages` / `conversation_members` ontbreken → één migratie die ze toevoegt aan `supabase_realtime`.
- Stap C: één kort debug-logje in de subscribe-callback in beide files om vast te leggen of de connectie succesvol is. Verwijderen na verificatie.

### Wat dit NIET aanraakt
- Geen wijziging aan de berichten-encryptie of de send-flow.
- Geen wijziging aan RLS-policies tenzij stap A en B het probleem niet zijn.
- Geen wijziging aan TanStack Query of routerstructuur.

---

## Probleem 2 — Push: VAPID-keypair is stuk

### Diagnose
- 07:49:09 verse subscription gemaakt na toggle uit/aan.
- 07:49:28 + 07:50:32 server probeert push → `403 invalid JWT`.
- Conclusie: `VAPID_PUBLIC_KEY` (client krijgt deze, browser bakt 'm in subscription) en `VAPID_PRIVATE_KEY` (server ondertekent JWT) horen niet bij elkaar.

### Stappen
- Genereer een vers VAPID-keypair (web-push standaard, P-256, base64url-encoded). Eenmalig lokaal met een kleine Node-script via `code--exec`.
- Vraag de gebruiker beide secrets te updaten in één keer via de secrets-tool: `VAPID_PUBLIC_KEY` en `VAPID_PRIVATE_KEY`.
- Verwijder de bestaande 1 stale subscription in `push_subscriptions` (gemaakt met de verkeerde publieke key).
- Gebruiker toggle meldingen één keer uit/aan op het toestel → verse subscription met de nieuwe publieke key.
- Stuur testbericht, verifieer `notify`-logs: `201` in plaats van `403`.

### Wat dit NIET aanraakt
- Geen wijziging aan de `notify` edge function code.
- Geen wijziging aan `src/lib/push.ts` of de service worker.
- Geen wijziging aan VAPID_SUBJECT (staat goed).

---

## Volgorde
Eerst probleem 1 (realtime) want dat is wat je nu in de app raakt. Probleem 2 (push) daarna in een aparte ronde. Beide los oppakken houdt de blast radius klein.
