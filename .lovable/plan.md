## Probleem

De toast "length cannot be null or undefined" verschijnt bij **Herstelcode aanmaken**. Oorzaak: het project heeft alleen `libsodium-wrappers` (minimal build) geïnstalleerd. Die bevat géén `crypto_pwhash` (Argon2id) — de KDF die we gebruiken om de herstelcode tot een wrap-key te derivereren. Daardoor is `sodium.crypto_pwhash_SALTBYTES` `undefined`, en de allereerste regel van `encryptRecoveryPayload` (`randombytes_buf(undefined)`) gooit de error. Hetzelfde gebeurt later bij `/recover` wanneer iemand een code probeert in te voeren.

De bestaande chat/bestanden/locatie-encryptie blijft werken — die gebruikt alleen `crypto_box`/`crypto_secretbox`, die wél in de minimal build zitten.

## Oplossing

Vervang `libsodium-wrappers` door `libsodium-wrappers-sumo`. De sumo-build is een **drop-in vervanger** met identieke API; voegt enkel de "minder gebruikte" primitives toe (zoals Argon2id, scrypt, Ed25519 conversies). Geen code-aanpassingen nodig behalve de import-strings. Bundle wordt ~150 KB groter (gzipped), eenmalig.

## Stappen

1. **Dependency wissel**: `bun remove libsodium-wrappers @types/libsodium-wrappers` + `bun add libsodium-wrappers-sumo @types/libsodium-wrappers-sumo`.
2. **Imports updaten** in alle bestanden die nu `from "libsodium-wrappers"` doen → `from "libsodium-wrappers-sumo"`. Verwacht ~2 bestanden (`src/lib/crypto.ts`, `src/lib/recovery.ts`).
3. **Verifiëren** dat de bestaande crypto-paden (sleutelgeneratie, berichten, bestanden) ongewijzigd functioneren — API is identiek.
4. **Smoke test** in de preview: open Account → "Herstelcode aanmaken" → code verschijnt → uitloggen → `/recover` → code plakken → terug ingelogd.

## Niet doen

- Geen aanpassing aan KDF-parameters, herstel-payload, RLS of crypto-primitives.
- Geen tweede sodium-instantie naast elkaar (vermijdt twee WASM-modules in de bundle).
- Geen wijziging aan de blob-inhoud (we hebben in de vorige iteratie al besloten: tokens blijven in de blob met het bekende kortere window).
