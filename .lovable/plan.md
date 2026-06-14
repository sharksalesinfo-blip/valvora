# Push fix: VAPID-mismatch oplossen

## Bewijs
- `notify` boot werkt (VAPID_SUBJECT-fix correct).
- FCM weigert nu elke push met `403 permission denied: invalid JWT provided`.
- Dit is een vaste handtekening voor: privé-key ondertekent ≠ publieke key in subscription.
- DB bevat 4 `push_subscriptions` rijen, allemaal FCM-endpoints, aangemaakt tussen 13 en 14 juni.

## Hypothese
Tijdens eerdere debug-rondes is `VAPID_PUBLIC_KEY` (of `_PRIVATE_KEY`) gewijzigd zonder de bijbehorende andere helft. Bestaande subscriptions zijn dan onherroepelijk ongeldig — FCM koppelt ze aan de publieke key die er op subscribe-moment was, en die kun je server-side niet "matchen" door alleen secrets te wijzigen.

## Stappen

### 1. Verifieer of huidige keypair geldig is
Lees beide secrets server-side en check of `VAPID_PUBLIC_KEY` de bijbehorende publieke punt is van `VAPID_PRIVATE_KEY` (web-push kan dit valideren). Twee uitkomsten:

- **Keypair klopt** → ga naar stap 2 (alleen subscriptions zijn stale).
- **Keypair klopt niet** → vraag de gebruiker welke kant juist is. Als geen van beide bekend is: genereer een vers keypair, vervang beide secrets, ga naar stap 2.

### 2. Stale subscriptions opruimen
`DELETE FROM push_subscriptions` (alle 4 rijen). Ze zijn permanent ongeldig — `notify` ruimt 404/410 op, maar 403 blijft komen tot ze handmatig weg zijn.

### 3. Verse subscription maken op het toestel
Gebruiker zet meldingen op de PWA één keer uit en weer aan (zodat `subscribePush` opnieuw draait met de juiste actuele publieke key). Stuur dan een testbericht en bevestig in de `notify`-logs dat het 201 wordt i.p.v. 403.

## Code dat aangeraakt wordt
- Nieuw eenmalig server-route of `createServerFn` voor het verifiëren van de keypair (puur diagnose, geen runtime-gedrag).
- Geen wijzigingen aan `src/lib/push.ts`, de service worker, de `notify` edge function logica, of de subscribe-flow zelf.
- Geen wijzigingen aan crypto, RLS, of berichten-flow.

## Wat dit NIET doet
- Geen rotatie van VAPID-keys tenzij stap 1 aantoont dat ze stuk zijn.
- Geen wijziging aan de neutrale push-payload.
- Geen poging om "oude" subscriptions te repareren — dat kan niet, alleen opnieuw aanmaken.
