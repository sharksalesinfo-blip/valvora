// Opslag van de PRIVATE sleutel van de huidige gebruiker.
// PWA-beperking: een browser kent geen écht veilige, niet-exporteerbare opslag
// voor X25519. We gebruiken IndexedDB per oorsprong. De sleutel blijft op het
// apparaat en wordt nooit naar de server gestuurd. Zie README in chat: punt 1.

const DB = "e2ee";
const STORE = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

export async function savePrivateKey(userId: string, privateKey: string): Promise<void> {
  await tx("readwrite", (s) => s.put(privateKey, `priv:${userId}`));
}

export async function loadPrivateKey(userId: string): Promise<string | null> {
  const v = await tx<string | undefined>("readonly", (s) => s.get(`priv:${userId}`));
  return v ?? null;
}

export async function clearPrivateKey(userId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(`priv:${userId}`));
}
