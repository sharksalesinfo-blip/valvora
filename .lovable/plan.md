# Fork-veiligheid: scan, checklist, opstartcheck

Drie onderdelen, in volgorde. **A wordt eerst gedraaid en gerapporteerd** voor B/C wordt geïmplementeerd, want als A iets vindt verandert de prioriteit (rotatie + historie opschonen voor publicatie).

## A. Secret-scan van de volledige git-historie

Doel: bewijzen dat de repo veilig publiek kan, niet alleen dat de huidige working tree schoon is.

Aanpak:
1. `gitleaks` draaien via `nix run nixpkgs#gitleaks -- detect --source . --log-opts="--all" --redact --report-format json --report-path /tmp/gitleaks.json` — scant alle commits op alle refs met de standaard rule-set (AWS, GCP, generic API keys, private keys, JWTs, etc.).
2. Aanvullend gerichte `git log -p --all -S<naam>` voor de namen die specifiek voor dit project gevoelig zijn: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`, `VAPID_PRIVATE_KEY`, `LOVABLE_API_KEY`, en patronen `BEGIN PRIVATE KEY`, `service_role`, `eyJ` (JWT-prefix in waardes, niet imports).
3. Working tree apart bevestigen: `.env` inhoud (alleen `VITE_*` + publishable mag), plus zoeken naar `.env.local`, `.env.production`, `*.sql.dump`, `*.backup`, seed-bestanden met echte data.
4. Rapportage in chat per bevinding: secret-type, commit-hash(es), pad, of het nog in HEAD staat, ernst.

Bij KRITIEK (een echte secret in historie): **stoppen, melden, niet zelf `git filter-repo` draaien**. Advies wordt dan: betreffende key direct roteren (service-role via `supabase--rotate_api_keys`, VAPID handmatig, LOVABLE_API_KEY via `ai_gateway--rotate_lovable_api_key`), repo niet publiek/forkbaar maken tot historie is opgeschoond, en bevestiging vragen voor de history-rewrite.

Bij schoon: dat expliciet rapporteren met aantal gescande commits.

## B. Fork-checklist in `SECURITY.md` sectie 4 + nieuwe `README.md`

`SECURITY.md` sectie 4 ("Self-hosting / forken") wordt bovenaan uitgebreid met een genummerde checklist (1‑5 zoals in de opdracht: eigen backend, eigen VAPID, vereisten-die-stil-falen-verwijzing, branding/SEO-bestanden om aan te passen, licentie + herkomstmelding). De bestaande detail-tekst over `libsodium-wrappers-sumo`, anonymous sign-in, `VAPID_SUBJECT`, edge functions, buckets en migraties blijft staan als referentie achter de checklist.

`README.md` bestaat nog niet in de repo — die wordt aangemaakt met: korte projectbeschrijving, link naar `SECURITY.md`, en **prominent bovenaan de installatie-sectie** dezelfde 5-puntenchecklist (met expliciete waarschuwing dat punt 1 niet-overslaan-baar is). Inclusief een zin "Dit is een fork van X; niet de officiële instance" als template voor forkers, en een licentie-keuze-prompt (voorstel: MIT of AGPL-3.0; ik vraag welke voor we het bestand vastleggen).

Geen wijzigingen aan crypto, RLS, notify-payload, of bestaande migraties.

## C. Onderzoek: opstartcheck tegen de originele backend-URL

**Voorgestelde aanpak (nog niet implementeren — wacht op akkoord):**

Een constante `ORIGINAL_INSTANCE_SUPABASE_URL = "https://xxddqmrwejrkpmpzlbtg.supabase.co"` (de huidige `VITE_SUPABASE_URL`) en een opt-in vlag `VITE_IS_ORIGINAL_INSTANCE=true` in `.env`. Bij app-start (in `src/start.ts` of `__root.tsx`):

- Als `VITE_SUPABASE_URL === ORIGINAL_INSTANCE_SUPABASE_URL` **en** `VITE_IS_ORIGINAL_INSTANCE !== "true"` → fullscreen blokpagina met uitleg "Je draait een fork tegen de originele valvora-backend. Vervang `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` met je eigen project, of zet `VITE_IS_ORIGINAL_INSTANCE=true` als jij de eigenaar bent."
- De officiële instance zet `VITE_IS_ORIGINAL_INSTANCE=true` in zijn eigen `.env` (eenmalig, nu meteen) en wordt dus nooit geblokkeerd.
- Werkt build-tijd én runtime (Vite `import.meta.env`), is in 30 seconden uit te zetten door een forker die zijn eigen URL invult — dus niet vijandig — en vangt de meest waarschijnlijke fout (`.env` vergeten te overschrijven) keihard af.

Valkuilen / overwegingen ter bespreking:
- De originele URL komt zo expliciet in de broncode te staan. Dat is geen secret (staat al in elke gepubliceerde build), maar wel zichtbaar — prima volgens mij.
- Een kwaadwillende forker kan de check verwijderen. Niet te voorkomen; doel is ongeluk afvangen, niet sabotage.
- Alternatief lichter: alleen een `console.warn` + toast i.p.v. blokpagina. Voorstel: blokpagina, want een waarschuwing wordt genegeerd.

Implementatie pas na expliciet "ja, bouw C in" — en ik zet dan ook meteen `VITE_IS_ORIGINAL_INSTANCE=true` in deze `.env` zodat de productie-instance niet zichzelf blokkeert.

## Volgorde van uitvoering

1. A draaien en rapporteren. Bij KRITIEK: stoppen.
2. B doorvoeren (vraag eerst: welke licentie?).
3. C: aanpak bevestigen, dan inbouwen.

## Niet aanraken

`src/lib/crypto.ts`, `src/lib/recovery.ts`, RLS-policies, `supabase/functions/notify/index.ts`-payload, `src/integrations/supabase/*` autogen.
