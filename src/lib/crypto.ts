// End-to-end encryption module — libsodium (NaCl).
// Schemas:
//   - berichten: crypto_box (X25519 + XSalsa20-Poly1305) — per-bericht nonce
//   - bestanden: crypto_secretbox (XSalsa20-Poly1305) met losse per-bestand sleutel
// Een verse willekeurige nonce per bericht via randombytes_buf (NOOIT hergebruiken).
// Nonce wordt naast de ciphertext opgeslagen (apart veld).

import sodium from "libsodium-wrappers-sumo";

let readyPromise: Promise<void> | null = null;
export function sodiumReady(): Promise<void> {
  if (!readyPromise) readyPromise = sodium.ready;
  return readyPromise;
}

export interface KeyPair {
  publicKey: string; // base64
  privateKey: string; // base64
}

const b64 = (b: Uint8Array) => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
const ub64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

// ---------- Sleutels ----------
export async function generateKeyPair(): Promise<KeyPair> {
  await sodiumReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: b64(kp.publicKey), privateKey: b64(kp.privateKey) };
}

// Korte, leesbare fingerprint van een publieke sleutel — voor out-of-band verificatie.
export async function publicKeyFingerprint(publicKeyB64: string): Promise<string> {
  await sodiumReady();
  const hash = sodium.crypto_generichash(16, ub64(publicKeyB64), null);
  // groepeer in blokjes van 4 hex chars
  const hex = sodium.to_hex(hash).toUpperCase();
  return hex.match(/.{4}/g)!.join(" ");
}

// ---------- Berichten ----------
export interface EncryptedMessage {
  ciphertext: string; // base64
  nonce: string; // base64
}

export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
  senderPrivateKey: string,
): Promise<EncryptedMessage> {
  await sodiumReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const cipher = sodium.crypto_box_easy(
    sodium.from_string(plaintext),
    nonce,
    ub64(recipientPublicKey),
    ub64(senderPrivateKey),
  );
  return { ciphertext: b64(cipher), nonce: b64(nonce) };
}

export async function decryptMessage(
  msg: EncryptedMessage,
  senderPublicKey: string,
  recipientPrivateKey: string,
): Promise<string> {
  await sodiumReady();
  const plain = sodium.crypto_box_open_easy(
    ub64(msg.ciphertext),
    ub64(msg.nonce),
    ub64(senderPublicKey),
    ub64(recipientPrivateKey),
  );
  return sodium.to_string(plain);
}

// ---------- Bestanden ----------
export interface EncryptedFile {
  ciphertext: Uint8Array;
  nonce: string; // base64
  key: string; // base64 — moet ZELF versleuteld worden verstuurd via encryptMessage
}

export async function encryptFile(plain: Uint8Array): Promise<EncryptedFile> {
  await sodiumReady();
  const key = sodium.crypto_secretbox_keygen();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(plain, nonce, key);
  return { ciphertext: cipher, nonce: b64(nonce), key: b64(key) };
}

export async function decryptFile(
  ciphertext: Uint8Array,
  nonceB64: string,
  keyB64: string,
): Promise<Uint8Array> {
  await sodiumReady();
  return sodium.crypto_secretbox_open_easy(ciphertext, ub64(nonceB64), ub64(keyB64));
}
