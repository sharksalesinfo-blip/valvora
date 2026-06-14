# Security — valvora

Dit document beschrijft de **werkelijke** beveiligings- en privacy-eigenschappen van valvora, niet de bedoeling. Het is geschreven voor drie lezers: onderhoud, een forker die een eigen instance opzet, en gebruikers die willen weten wat wel en niet beschermd is.

valvora is gebouwd voor besloten kringen (familie, vrienden, vaste teams). Het is geen publieke berichtendienst en niet onafhankelijk geauditeerd.

---

## 1. Wat valvora wél beschermt

- **End-to-end versleuteling van inhoud.** Tekst, bestanden en locatiepunten worden client-side versleuteld voordat ze de browser verlaten. De server slaat uitsluitend ciphertext op.
  - Berichten: `crypto_box` (X25519 + XSalsa20-Poly1305). Zie `src/lib/crypto.ts` (`encryptMessage` / `decryptMessage`).
  - Bestanden: `crypto_secretbox` met een losse, per-bestand symmetrische sleutel; die sleutel wordt zelf via `crypto_box` aan de ontvanger gestuurd. Zie `encryptFile` / `decryptFile` in `src/lib/crypto.ts`.
  - Envelope met type/metadata (bestandsnaam, mime, caption, fwd-vlag, lat/lng) zit **binnen** de versleutelde payload — zie `src/lib/message-envelope.ts`.
- **Verse, unieke nonce per bericht en per bestand** via `randombytes_buf` (libsodium). Nonce wordt apart naast de ciphertext opgeslagen; er wordt nooit een nonce hergebruikt.
- **Geen telefoonnummer, geen e-mail, geen commerciële tracking.** Aanmelden gebeurt passwordless via een invite-link of QR (Supabase anonymous sign-in). Er is geen koppeling aan een extern identiteits-ecosysteem.
- **Out-of-band sleutelverificatie.** Gebruikers kunnen elkaars publieke sleutel verifiëren via QR + leesbare fingerprint (`publicKeyFingerprint` in `src/lib/crypto.ts`, UI in `src/components/verify-contact-dialog.tsx` / `key-qr-code.tsx`). Geverifieerde status wordt opgeslagen in `contact_verifications`. Bij een **sleutelwijziging mid-sessie** waarschuwt de app — er is een realtime listener op `profiles.public_key`.
- **Push-meldingen bevatten nooit inhoud.** De `notify` edge function bouwt zelf een neutrale payload (`"Nieuw bericht"` of `"Nieuw bericht in <groepsnaam>"`) en heeft technisch geen toegang tot de ciphertext. De client accepteert ook alleen `{ conversation_id }` als input. Zie `supabase/functions/notify/index.ts`.
- **Row Level Security op alle gebruikerstabellen.** Gebruikers kunnen alleen gesprekken en berichten zien waar ze lid van zijn. Contact-koppelingen en invite-tokens lopen via afgeschermde server-functions (`src/lib/contacts.functions.ts`, `src/lib/recovery.functions.ts`).
- **Avatars privé.** De `avatars` storage bucket is non-public en zichtbaarheid mirrort de profielregel: alleen de eigenaar, hun contacten of leden van een gedeeld gesprek kunnen een avatar lezen (zie laatste migratie in `supabase/migrations/`).

## 2. Wat valvora **niet** beschermt — de eerlijke grenzen

- **Metadata is leesbaar voor wie service-role-toegang tot de database heeft** (de serverbeheerder van die instance, of iemand met een rechtmatig bevel richting die beheerder). Concreet zichtbaar:
  - wie lid is van welk gesprek (`conversation_members`) — dus *wie-met-wie*
  - tijdstippen van berichten en gesprekken (`messages.created_at`, `conversations.updated_at`)
  - display name, handle, publieke sleutel en fingerprint (`profiles`)
  - contactenlijst en geverifieerd-status (`contacts`, `contact_verifications`)
  - push-subscription endpoints (`push_subscriptions`)
  - groepsnamen (voor type=group conversations)

  **Inhoud van berichten en bestanden is dat niet** — alleen ciphertext + nonce staat op de server.

- **Geen forward secrecy.** Elke gebruiker heeft één X25519-sleutelpaar dat over de hele levensduur van het account hergebruikt wordt. Als een private key ooit lekt, is in principe alle eerdere én latere inhoud van die gebruiker leesbaar voor wie ook de ciphertext bezit. Dit is een bewuste keuze: een Signal-achtig double-ratchet protocol is niet geïmplementeerd omdat zelfgebouwde crypto op dat niveau meer risico dan winst geeft.
- **Sleutelopslag is browser-IndexedDB, geen hardware-enclave.** Zie `src/lib/local-key-store.ts`. Een browser kent geen écht veilige, niet-exporteerbare opslag voor X25519. Bij apparaat-toegang of malware op het apparaat is de private key in principe uitleesbaar door code in dezelfde origin.
- **Niet onafhankelijk geauditeerd.** De crypto-implementatie leunt op libsodium (goed), maar de manier waarop valvora die gebruikt is niet door externe cryptografen gereviewd.
- **Geen multi-device.** De private key staat alleen op het apparaat waarop hij is gegenereerd. Inloggen op een tweede apparaat zonder herstelcode = nieuw sleutelpaar = oude berichten niet leesbaar op dat tweede apparaat.
- **Geen bescherming tegen een rechtmatig bevel** richting de serverbeheerder voor de metadata die hierboven als leesbaar staat. valvora claimt dat ook niet te doen.

## 3. Account- en herstelmodel

- **Aanmelden.** Passwordless via invite-link of QR. Onder de motorkap een Supabase anonymous sign-in; identiteit = lokale private key + `auth.uid()`. Er is geen wachtwoord en geen e-mailadres om te resetten.
- **Herstelcode (optioneel).** Bij het aanmaken kan een gebruiker een herstelcode opslaan (30 base32-tekens, zes blokken van vijf). Implementatie in `src/lib/recovery.ts`:
  - De eerste 10 tekens zijn een publieke `recovery_id` (lookup-handle in de DB).
  - De laatste 20 tekens zijn het geheim. Via Argon2id (`crypto_pwhash`, ALG_ARGON2ID13, ops=3, mem=64 MB) wordt daaruit een 32-byte wrap-key afgeleid.
  - De server slaat alleen `{ ciphertext, nonce, kdf_salt, kdf_opslimit, kdf_memlimit }` op (tabel `key_recovery`). Het geheim verlaat het apparaat nooit. Er is geen server-side reset.
- **Wat zit er in de versleutelde herstel-blob.** Bewust gekozen voor "optie 3" (kortere, tijdsgebonden window, simpeler code) boven proof-of-possession + admin-minted session. De payload bevat `{ v: 1, user_id, private_key, refresh_token, access_token? }` (zie `RecoveryPayload` in `src/lib/recovery.ts`). Gevolgen, eerlijk benoemd:
  - **Herstel is tijdsgebonden.** Het werkt zolang de meegegeven `refresh_token` nog geldig is. Supabase laat refresh-tokens na een periode van inactiviteit verlopen. Wie zeer lang inactief is geweest, kan met een oude herstelcode mogelijk niet meer inloggen — de UI op `/recover` zegt dat dan ook (zie `src/routes/recover.tsx`).
  - **Een uitgelekte herstelcode geeft, naast de private key, ook tijdelijk geldige sessietokens prijs.** Behandel de code als een sleutel: bewaar hem fysiek of in een wachtwoordmanager, niet in een mailbox.
- **Wat herstel wél terugbrengt:** dezelfde identiteit (`auth.uid()` + `public_key`), contacten, verificaties, en alle berichten/bestanden die als ciphertext op de server staan.
- **Wat herstel níet terugbrengt:** berichten of bestanden die alleen lokaal op een verloren apparaat stonden (er is geen lokale geschiedenisbackup).

## 4. Self-hosting / forken

Een fork is een **gesloten eiland**: gebruikers op verschillende valvora-instances kunnen niet met elkaar chatten. Dat is bewust en past bij het "losse kring"-model.

Wat een forker moet inrichten — de niet-vanzelfsprekende dingen eerst, want die falen anders stil:

- **`libsodium-wrappers-sumo` is vereist**, niet `libsodium-wrappers` (de minimal build). De minimal build mist `crypto_pwhash` (Argon2id); de app compileert dan schoon maar de herstelcode crasht bij runtime. Zie `package.json` en alle imports in `src/lib/crypto.ts` / `src/lib/recovery.ts`.
- **Anonymous sign-ins moeten AAN staan** in het Supabase-project. Anders mislukt elke aanmelding direct, zonder duidelijke foutmelding voor de eindgebruiker.
- **`VAPID_SUBJECT` moet een geldige URL zijn** — `mailto:adres@domein.tld` of `https://domein.tld`. Een kaal e-mailadres laat de `notify` edge function bij boot crashen (`web-push` valideert dit strikt) en er komt dan geen enkele push aan. Default fallback in de code is `mailto:admin@example.com`; zet dit expliciet op iets correct.
- **VAPID-sleutelpaar als secrets**: `VAPID_PUBLIC_KEY` en `VAPID_PRIVATE_KEY`. De public key komt ook in de client (via `src/lib/vapid.functions.ts`). De private key blijft serverside.
- **Edge functions** die uitgerold moeten zijn: `notify` (in `supabase/functions/notify/`). Dit is bewust het enige pad dat pushes kan versturen, en alleen na server-side membership-check op `conversation_members` — er is geen ongeautoriseerd "all-subscriptions"-endpoint.
- **Storage buckets** (beide privé): `attachments` (versleutelde bestanden) en `avatars`.
- **Database**: alle migraties in `supabase/migrations/` toepassen. Dat zet onder andere op: `profiles`, `contacts`, `contact_verifications`, `conversations`, `conversation_members`, `messages`, `push_subscriptions`, `key_recovery`, `user_invites`, plus RLS-policies en de `private.shares_conversation_with()` helper waar het avatar-policy op leunt.
- **Auth providers**: alleen anonymous sign-in is nodig. Geen e-mail, geen OAuth.
- **PWA-icon en manifest** zijn cosmetisch maar zorg dat het origin (HTTPS) klopt — service worker en push-subscription weigeren anders te registreren.

## 5. Verantwoordelijkheid en scope

- valvora is gebouwd voor **besloten kringen**, niet als publieke dienst.
- Een self-hoster is voor zijn eigen instance verwerkingsverantwoordelijke onder de AVG; valvora levert geen centrale dienst en kan dat dus niet voor je zijn.
- valvora **omzeilt geen overheids- of juridische toegang tot metadata**. Voor inhoud is er niets te overleggen omdat de server die niet bezit; voor metadata (zie sectie 2) ligt dat anders.
- Gebruik valvora niet als enige communicatiekanaal voor situaties waar leven of vrijheid van afhangt. Voor dat dreigingsmodel zijn er specifiek-daarvoor-gebouwde en geauditeerde tools.

---

## Bijlage — bronverwijzingen

| Claim | Geverifieerd in |
|---|---|
| crypto_box voor berichten, crypto_secretbox voor bestanden, verse nonce per item | `src/lib/crypto.ts` |
| Envelope-veld (bestandsnaam, caption, locatie) zit binnen ciphertext | `src/lib/message-envelope.ts` |
| Private key in IndexedDB, niet op de server | `src/lib/local-key-store.ts`, `src/lib/ensure-keys.ts` |
| Push-payload bevat geen inhoud; caller-membership wordt server-side gecheckt | `supabase/functions/notify/index.ts` |
| Argon2id-KDF en samenstelling van herstel-payload | `src/lib/recovery.ts` |
| `libsodium-wrappers-sumo` is de gebruikte build | `package.json` |
| Avatar-RLS mirrort profielzichtbaarheid | laatste migratie in `supabase/migrations/` |

## Bijlage — discrepanties tussen aanname en code

Tijdens het opstellen geen discrepanties gevonden tussen wat in eerdere iteraties is gecommuniceerd en wat de code werkelijk doet. `notify` is bewust het enige pad dat pushes kan versturen, en doet dat alleen na een server-side membership-check op `conversation_members`. Er bestaat geen ongeautoriseerd "all-subscriptions"-pad.
