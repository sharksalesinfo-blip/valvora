# valvora

End-to-end versleutelde chat voor je eigen kring — besloten en privé. Geen telefoonnummer, geen e-mail, geen tracking. Aanmelden via invite-link of QR.

Volledige technische- en privacy-uitleg staat in [`SECURITY.md`](./SECURITY.md). Lees die voor je een instance opzet of forkt.

---

## ⚠️ Voor je forkt — lees dit eerst

Forken kan, maar een fork van valvora is een **gesloten eiland** (gebruikers van verschillende instances kunnen niet met elkaar chatten) en draait standaard tegen de backend van wie hem heeft geforkt. Loop deze vijf punten af **vóór** je de fork live zet:

1. **Eigen backend.** Maak een nieuw, leeg Supabase/Lovable Cloud-project. Overschrijf in `.env` de variabelen `VITE_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` en `SUPABASE_PROJECT_ID` met jouw eigen waarden. **Dit is niet-overslaan-baar** — anders maken jouw gebruikers accounts aan in de database van iemand anders. Zie ook de opstartcheck verderop.
2. **Eigen VAPID-paar.** Genereer een vers keypair (web-push standaard, P-256). Hergebruik nooit dat van een andere instance. Zet serverside als secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, en `VAPID_SUBJECT` als geldige URL (`mailto:jij@domein.tld` of `https://domein.tld`).
3. **Vereisten die anders stil falen.** Gebruik `libsodium-wrappers-sumo` (niet de minimal build), zet anonymous sign-ins AAN in Supabase, pas alle migraties uit `supabase/migrations/` toe, houd de storage buckets `attachments` en `avatars` privé, en deploy de `notify` edge function (en geen debug-/test-pushfunctie).
4. **Branding & SEO.** Pas alle verwijzingen naar `valvora` / `valvora.nl` aan: `public/manifest.webmanifest`, JSON-LD in `src/routes/__root.tsx`, `public/llms.txt`, `public/robots.txt`, `public/sitemap.xml`, en de icon-/og-assets in `public/`. Anders draai je onder andermans merk met duplicate content.
5. **Licentie & herkomst.** Voeg een licentiebestand toe en zet bovenaan **deze README** in je fork: *"Dit is een fork van valvora; dit is niet de officiële instance."* Eindgebruikers moeten weten met wiens code en instance ze praten — relevant omdat een forker `src/lib/crypto.ts` kan wijzigen.

Volledige uitleg en achtergrond staan in [`SECURITY.md` sectie 4](./SECURITY.md#4-self-hosting--forken).

---

## Lokaal draaien

```sh
bun install
bun run dev
```

Stack: TanStack Start (React 19, Vite 7), Tailwind v4, libsodium voor crypto, Supabase voor opslag/auth/realtime.

## Licentie

valvora staat onder de **GNU Affero General Public License v3.0** — zie [`LICENSE`](./LICENSE).

**Wat dat in normale taal betekent voor een forker:** je mág valvora forken, aanpassen en zelf uitrollen. Maar zodra je je fork als dienst aanbiedt aan andere mensen — ook gratis, ook binnen één familie of vereniging — móet je je broncode inclusief jouw wijzigingen beschikbaar stellen aan die gebruikers. Dat is bewust gekozen: valvora is een privacy-app, en bij een privacy-app is het juist het punt dat iedereen kan controleren wat de code doet. Zonder die plicht zou een fork stilletjes de crypto kunnen wijzigen of telemetrie kunnen toevoegen zonder dat gebruikers het weten. Met AGPL blijft elke fork transparant.

Praktisch: voeg een zichtbare link toe naar je broncode (bv. in de app-footer of `/about`), houd de licentietekst bij wat je distribueert, en wijzig of verwijder de licentievermelding niet.

