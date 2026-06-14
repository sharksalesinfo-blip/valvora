// Herstelcode: client-side encryptie van de private key.
//
// Format van de code die de gebruiker te zien krijgt: 30 base32-tekens
// (alfabet zonder 0/O/1/I/L) in 6 blokken van 5, gescheiden door "-".
// De eerste 10 tekens zijn een publieke `recovery_id` (lookup-handle in
// de DB). De laatste 20 tekens zijn het geheim dat NOOIT op de server komt;
// daaruit leiden we via Argon2id een 32-byte key af die de payload versleutelt.
//
// Server slaat enkel ciphertext + KDF-parameters op. Zonder de code is de
// blob niet ontsleutelbaar.

import sodium from "libsodium-wrappers";
import { sodiumReady } from "./crypto";

// Crockford-style base32 (32 chars, excludes I L O U for readability).
const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 0x1f];
  return out;
}

function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V")
    .replace(/[^0-9A-Z]/g, "");
}

export interface ParsedRecoveryCode {
  recoveryId: string;
  secret: string;
}

export function parseRecoveryCode(input: string): ParsedRecoveryCode | null {
  const c = normalizeCode(input);
  if (c.length !== 30) return null;
  for (const ch of c) if (!ALPH.includes(ch)) return null;
  return { recoveryId: c.slice(0, 10), secret: c.slice(10) };
}

export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,5}/g)!.join("-");
}

/** Generate a fresh recovery code (raw 30 base32 chars). */
export async function generateRecoveryCode(): Promise<string> {
  await sodiumReady();
  // 19 bytes ≈ 152 bits → 31 base32 chars; trim to 30.
  const raw = sodium.randombytes_buf(19);
  return bytesToBase32(raw).slice(0, 30);
}

export interface KdfParams {
  salt: string; // base64
  opslimit: number;
  memlimit: number;
}

const OPSLIMIT = 3; // crypto_pwhash_OPSLIMIT_MODERATE-ish; sodium constant available at runtime
const MEMLIMIT = 67108864; // 64 MB — INTERACTIVE; mobile-safe

const b64 = (b: Uint8Array) => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
const ub64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

async function deriveKey(secret: string, salt: Uint8Array, ops: number, mem: number): Promise<Uint8Array> {
  await sodiumReady();
  return sodium.crypto_pwhash(
    32,
    sodium.from_string(secret),
    salt,
    ops,
    mem,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export interface RecoveryBlob {
  recovery_id: string;
  ciphertext: string;
  nonce: string;
  kdf_salt: string;
  kdf_opslimit: number;
  kdf_memlimit: number;
}

export interface RecoveryPayload {
  v: 1;
  user_id: string;
  private_key: string;
  refresh_token: string;
  access_token?: string;
}

/** Encrypt the recovery payload using the secret part of the code. */
export async function encryptRecoveryPayload(
  code: string,
  payload: RecoveryPayload,
): Promise<{ blob: RecoveryBlob; derivedKey: Uint8Array }> {
  await sodiumReady();
  const parsed = parseRecoveryCode(code);
  if (!parsed) throw new Error("Ongeldige herstelcode");
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = await deriveKey(parsed.secret, salt, OPSLIMIT, MEMLIMIT);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(sodium.from_string(JSON.stringify(payload)), nonce, key);
  return {
    blob: {
      recovery_id: parsed.recoveryId,
      ciphertext: b64(cipher),
      nonce: b64(nonce),
      kdf_salt: b64(salt),
      kdf_opslimit: OPSLIMIT,
      kdf_memlimit: MEMLIMIT,
    },
    derivedKey: key,
  };
}

/** Re-encrypt a fresh payload with an already-derived key (for refresh-token rotation). */
export async function reencryptRecoveryPayload(
  derivedKey: Uint8Array,
  payload: RecoveryPayload,
): Promise<{ ciphertext: string; nonce: string }> {
  await sodiumReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(
    sodium.from_string(JSON.stringify(payload)),
    nonce,
    derivedKey,
  );
  return { ciphertext: b64(cipher), nonce: b64(nonce) };
}

export async function decryptRecoveryBlob(
  code: string,
  blob: Pick<RecoveryBlob, "ciphertext" | "nonce" | "kdf_salt" | "kdf_opslimit" | "kdf_memlimit">,
): Promise<RecoveryPayload> {
  await sodiumReady();
  const parsed = parseRecoveryCode(code);
  if (!parsed) throw new Error("Ongeldige herstelcode");
  const key = await deriveKey(parsed.secret, ub64(blob.kdf_salt), blob.kdf_opslimit, blob.kdf_memlimit);
  const plain = sodium.crypto_secretbox_open_easy(ub64(blob.ciphertext), ub64(blob.nonce), key);
  const obj = JSON.parse(sodium.to_string(plain)) as RecoveryPayload;
  if (obj.v !== 1) throw new Error("Onbekend herstelformaat");
  return obj;
}

/** Persist derived key on the original device so we can re-encrypt on token rotation. */
const DB = "e2ee";
const STORE = "keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

export async function cacheRecoveryWrapKey(userId: string, recoveryId: string, key: Uint8Array): Promise<void> {
  await tx("readwrite", (s) => s.put({ recoveryId, key: b64(key) }, `recovery:${userId}`));
}

export async function loadRecoveryWrapKey(userId: string): Promise<{ recoveryId: string; key: Uint8Array } | null> {
  const v = await tx<{ recoveryId: string; key: string } | undefined>("readonly", (s) => s.get(`recovery:${userId}`));
  if (!v) return null;
  await sodiumReady();
  return { recoveryId: v.recoveryId, key: ub64(v.key) };
}

export async function clearRecoveryWrapKey(userId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(`recovery:${userId}`));
}
