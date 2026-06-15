## Wijzigingen

### 1. Nieuw bestand `src/lib/inbox-delivery.ts`
Eén helper die alles bundelt:
- `catchUpDelivered(userId, limit=100)` — query de recentste 100 berichten waar `recipient_id = me` en `sender_id != me`, en roep `writeStatus(..., "delivered")` aan per groep. `writeStatus` is al idempotent (PK-conflict op `(group_id, user_id, status)` wordt stil geslikt), dus dubbele rijen kunnen niet ontstaan.
- `installInboxDeliveryTracker(userId)` — installeert:
  1. directe inhaalslag bij mount,
  2. realtime kanaal `inbox:${userId}` met filter `recipient_id=eq.<userId>` op `messages` → `writeStatus` delivered (skip eigen kopie),
  3. `visibilitychange` + `focus` listener → opnieuw `catchUpDelivered` bij resume,
  4. retourneert cleanup die het kanaal verwijdert en listeners afmeldt.

### 2. `src/routes/_authenticated/route.tsx`
Eén `useEffect` toevoegen die `installInboxDeliveryTracker(user.id)` mount zolang de gebruiker is ingelogd. Cleanup ruimt het kanaal op bij uitloggen/unmount. Geplaatst naast de bestaande `installBadgeResetOnForeground`-effect.

### 3. `src/routes/_authenticated/chats.tsx`
Eenmalig `void catchUpDelivered(user.id)` aanroepen in het bestaande mount-effect (regel 87). Lichte extra dekking voor openen-vanuit-koud naast de globale tracker; vrijwel gratis omdat het dezelfde idempotente helper is.

### 4. `SECURITY.md` sectie 2 (regel 31)
Eén zin toevoegen: "`delivered` wordt naast in het chatscherm ook geschreven door een globale inbox-listener en een resume-inhaalslag bij visibility/focus — nog steeds zonder berichtinhoud, nog steeds pure metadata."

## Niet aanraken
- `src/lib/message-status.ts` — `aggregateStatus` borgt al dat `read` impliceert `delivered` (regel 56: bij een `read`-rij wordt `user_id` óók aan de `delivered`-set toegevoegd). Geen wijziging nodig; rangorde sent < delivered < read blijft intact.
- `showRead` / wederkerige leesbevestiging-logica.
- Bestaande `chat:${convId}`-handler en `markVisibleAsRead`-effect in `chat.$id.tsx` — die blijven `read` schrijven zodra de chat zichtbaar is. Volgorde delivered-vóór-read wordt gegarandeerd doordat `read` `delivered` impliceert in de aggregator, en doordat het chatscherm sowieso altijd óók `delivered` schrijft vóór `read` in dezelfde handler (regels 434–451).
- RLS, crypto, sleutelopslag, push-payload, service worker (stap 3 bewust overgeslagen).

## Verificatie na implementatie
Per testpunt 1–5 uit de opdracht PASS/FAIL rapporteren, met expliciete bevestiging dat:
- de wederkerige `showRead`-logica intact is,
- stap 3 (SW-delivered) bewust niet is geïmplementeerd.

Geen migratie nodig — schema en RLS van `message_status` blijven ongewijzigd.
