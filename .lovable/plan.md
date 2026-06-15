
# Fix: bericht verschijnt soms pas na refresh in openstaande chat

## Wat er gebeurt

In `src/routes/_authenticated/chat.$id.tsx` luistert het `chat:${convId}`-kanaal op `INSERT` op `messages`. Als de websocket kort wegvalt (telefoon in rust, scherm uit, netwerkwissel, tab in achtergrond) en weer terugkomt, *re-subscribet* het kanaal wel, maar Supabase Realtime **replayt geen gemiste events**. Berichten die tijdens die gap binnenkwamen, zitten wel in de database maar niet in `messages`-state — pas een refresh (die `load()` opnieuw uitvoert) toont ze.

Dezelfde gap geldt voor `status:${convId}` (aflever-/leesstatussen) en is waarschijnlijk de reden dat vinkjes ook af en toe pas na refresh bijwerken.

## Wat we niet aanpakken

- Stap 3 (service-worker schrijft `delivered` terwijl app slaapt) blijft bewust open — dat is een aparte ingreep en niet wat de gebruiker nu vraagt.
- `aggregateStatus`, `writeStatus`, RLS, crypto, wederkerige leesbevestigingen, push-payload: niets aan raken.
- De `inbox:${userId}` listener uit de vorige fix blijft staan; die schrijft alleen `delivered`, niet de UI-state van een open chat.

## De fix

Eén kleine helper per kanaal: bij elke transitie naar zichtbaar/focus én bij elk `SUBSCRIBED`-event (dat ook bij een reconnect afgaat) een **delta-fetch** uitvoeren tegen de DB en alleen ontbrekende rijen mergen in state.

### 1) `chat.$id.tsx` — berichten

In de berichten-`useEffect` (regel 289-463):

- Bewaar `lastCreatedAtRef` (ref) — bijwerken telkens als er een nieuw bericht in state komt (zowel via `load()` als via realtime-INSERT).
- Nieuwe inner-functie `catchUp()`:
  - Query `messages` waar `conversation_id = convId`, `recipient_id = user.id`, `created_at > lastCreatedAtRef.current` (of altijd als ref leeg is), `order by created_at asc`.
  - Filter dubbelen via dezelfde `seen`-sleutel als `load()`.
  - Per nieuwe row: `decryptOne` + `setMessages(prev => …)` met id-dedupe (zelfde patroon als de huidige INSERT-handler), en schrijf `delivered`/`read` met dezelfde voorwaarden.
- Triggers voor `catchUp()`:
  - `document.addEventListener("visibilitychange", …)` → bij `visible`.
  - `window.addEventListener("focus", …)`.
  - In `.subscribe((status) => { if (status === "SUBSCRIBED") void catchUp(); })` — vangt de reconnect na een gap.
- Cleanup: listeners verwijderen in de bestaande `return`.

### 2) `chat.$id.tsx` — statussen

Hetzelfde patroon in de statussen-`useEffect` (regel 471-515):

- `lastStatusAtRef` (ref) op `at` van de meest recente status.
- `catchUpStatuses()` haalt `message_status` waar `conversation_id = convId` en `at > lastStatusAtRef.current`, merget in `statuses`-map met dezelfde dedupe op `(user_id, status)` als de huidige INSERT-handler.
- Triggers: `visibilitychange` → `visible`, `focus`, en `SUBSCRIBED` in de `.subscribe(...)`-callback.

### 3) Geen wijzigingen elders

- `inbox-delivery.ts`, `route.tsx`, `chats.tsx`, `send-message.ts`, `push.ts`, `sw.js`: ongemoeid.
- Geen DB-migraties.
- Geen wijzigingen aan UI of rendervolgorde.

## Waarom dit klopt

- Pure inhaalslag: we vertrouwen nog steeds op realtime voor de happy-path latency; de catch-up is alleen vangnet bij reconnect/wake.
- Idempotent: id-dedupe op berichten en `(user_id, status)`-dedupe op statussen, plus `writeStatus` dat al PK-conflict slikt — herhaalde catch-ups doen geen kwaad.
- Geen race met `load()`: de ref houdt het hoogste bekende `created_at`/`at` bij, dus de delta-query is altijd strikt nieuwer.

## Testplan (twee toestellen, A → B)

1. B in deze chat open, scherm aan → bericht binnen ~1s zichtbaar (regressie: realtime werkt nog). PASS/FAIL.
2. B in deze chat open, telefoon 30s in rust, dan wakker → bericht verschijnt direct bij resume, **geen** refresh nodig. PASS/FAIL.
3. B in deze chat open, vliegtuigmodus 20s, dan weer aan → bericht verschijnt zodra kanaal opnieuw `SUBSCRIBED` is. PASS/FAIL.
4. Vinkjes-regressie: B opent chat met A, A heeft eerder bericht gestuurd → twee vinkjes / blauw verschijnt zoals voorheen. PASS/FAIL.
5. Wederkerigheid leesbevestiging UIT: A blijft op twee vinkjes, B ziet geen blauw op eigen berichten — ongewijzigd. PASS/FAIL.
