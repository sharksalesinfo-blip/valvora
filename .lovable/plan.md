## Doel
Voorkomen dat twee gebruikers dezelfde handle kunnen instellen.

## Wijziging
Eén database-migratie die een **case-insensitive unique index** plaatst op `profiles.handle` (NULL blijft toegestaan, zodat gebruikers zonder handle mogelijk blijven):

```sql
CREATE UNIQUE INDEX profiles_handle_unique_ci
  ON public.profiles (lower(handle))
  WHERE handle IS NOT NULL;
```

Waarom case-insensitive: de app zoekt handles met `ilike` (`@Jan` = `@jan`), dus de uniciteit moet ook hoofdletter-ongevoelig zijn — anders kunnen `jan` en `JAN` naast elkaar bestaan en blijft het probleem.

## Code
Geen wijzigingen nodig. `setHandle` in `src/lib/contacts.functions.ts` vangt foutcode `23505` al af met de melding *"Deze handle is al in gebruik"*; die werkt zodra de unieke index bestaat.

## Geen wijziging
- `display_name` blijft niet-uniek (mensen mogen dezelfde getoonde naam hebben; de handle is het unieke aanknopingspunt).
- Bestaande data bevat geen dubbele handles, dus de index slaagt zonder opschoning.
