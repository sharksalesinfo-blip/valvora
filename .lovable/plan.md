## Doel
"new row violates row-level security policy for table conversations" verhelpen bij het starten van een nieuw gesprek en bij het aanmaken van een nieuwe groep, zonder RLS te verzwakken.

## Oorzaak (kort)
`supabase.from("conversations").insert(...).select("id").single()` triggert een `INSERT ... RETURNING`. Postgres toetst de RETURNING óók aan de SELECT-policy van `conversations`, en die eist lidmaatschap via `conversation_members`. Op dat moment bestaat er nog geen lidmaatschapsrij → SELECT faalt → Postgres meldt het als RLS-violation op de insert. Pas daarna voegt de client de members toe, dus het lukt nooit op deze volgorde.

## Aanpak
Conversatie + members atomisch aanmaken via een nieuwe authenticated server-functie, zodat:
- de client geen `.select()` op `conversations` meer hoeft te doen voordat hij lid is;
- de creator gegarandeerd direct als member staat (geen race);
- RLS exact hetzelfde blijft (geen policy-versoepeling).

### 1. Nieuwe server-functie `createDirectConversation`
Bestand: `src/lib/conversations.functions.ts` (client-safe pad, `requireSupabaseAuth`-middleware).
- Input: `{ other_user_id: string }` (UUID-validatie + ≠ caller).
- Eist dat `other_user_id` een contact is van de caller (lookup in `contacts`) en een `public_key` heeft (lookup in `profiles`). Zonder die check is dit een vector om willekeurige gesprekken op vreemden te starten.
- Hergebruik bestaand direct-gesprek: zoek via `conversation_members` of er al een `type='direct'`-gesprek bestaat waar beide users in zitten; zo ja, geef dat id terug.
- Anders: gebruik `supabaseAdmin` (handler-local `await import("@/integrations/supabase/client.server")`) om in één call `conversations` te inserten met `created_by = context.userId` én meteen de twee `conversation_members`-rijen. RLS wordt bewust omzeild omdat de server-functie zélf de autorisatie heeft uitgevoerd.
- Return: `{ id: string, existed: boolean }`.

### 2. Nieuwe server-functie `createGroupConversation`
Zelfde bestand.
- Input: `{ name: string (1..80), member_ids: string[] (1..50, allemaal UUID, geen duplicaten, ≠ caller) }`.
- Verifieer dat élk `member_ids[i]` een contact van de caller is met `public_key`. Onbekende of niet-bevriende ids → error (geen silent drop).
- Maak `conversations` (`type='group'`, `name`, `created_by`) + alle `conversation_members` aan met `supabaseAdmin`.
- Return: `{ id: string }`.

### 3. `src/routes/_authenticated/new.tsx` aanpassen
- `startDirect` vervangt het huidige insert-blok door één call naar `createDirectConversation` via `useServerFn`.
- Lokale lookup van bestaand direct-gesprek vervalt (server doet dat nu).
- Bij succes navigeren naar `/chat/$id`.
- Errorpad blijft: `toast.error(e.message)`.

### 4. `src/routes/_authenticated/groups.new.tsx` aanpassen
- `create()` vervangt insert-blok door call naar `createGroupConversation`.
- Lokale insert in `conversation_members` vervalt.
- Bij succes navigeren naar `/chat/$id`.

### 5. Geen DB-migratie nodig
RLS-policies blijven exact zoals ze zijn. Geen nieuwe tabellen, geen nieuwe grants. De fix zit volledig in app-code.

## Verificatie
- `/new` → contact aantikken → chat opent zonder rode toast.
- `/new` → tweede keer hetzelfde contact aantikken → opent hetzelfde gesprek (geen duplicaat).
- `/groups/new` → naam + ≥1 deelnemer → groep wordt aangemaakt en opent.
- Poging om groep te maken met een willekeurige `user_id` die geen contact is (handmatig via devtools) → server geeft nette error, geen rij in DB.
- Bestaande chats/berichten/push/verificatie/sleutelwijziging-banner ongewijzigd.

## Technische details
- Server-functies volgen het bestaande patroon uit `src/lib/contacts.functions.ts`: `createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(...).handler(...)` met `supabaseAdmin` lazy-imported binnen `.handler`.
- Reden om `supabaseAdmin` te gebruiken: de schrijfacties op `conversations` + `conversation_members` moeten in één logische stap gebeuren terwijl er nog geen lidmaatschap bestaat — exact het scenario waarvoor RLS-bypass via een geautoriseerde server-functie bedoeld is. Autorisatie (caller is ingelogd, target is een contact) wordt expliciet in de handler gedaan vóór elke write.
- Geen wijziging aan `chat.$id.tsx`, crypto-laag, push-flow, verificatie of invite-/QR-flows.
