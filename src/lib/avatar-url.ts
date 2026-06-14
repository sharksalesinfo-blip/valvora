// Resolve avatar storage paths to signed URLs (private bucket).
// In-memory cache to avoid spamming createSignedUrl across renders.
import { supabase } from "@/integrations/supabase/client";

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();
const TTL_SECONDS = 60 * 60; // 1h

export function isStoragePath(v: string | null | undefined): v is string {
  if (!v) return false;
  return !v.startsWith("http://") && !v.startsWith("https://") && !v.startsWith("data:");
}

export async function resolveAvatarUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!isStoragePath(value)) return value; // already a full URL / data URL
  const now = Date.now();
  const cached = cache.get(value);
  if (cached && cached.expiresAt > now + 30_000) return cached.url;
  const existing = inflight.get(value);
  if (existing) return existing;
  const p = (async () => {
    const { data } = await supabase.storage.from("avatars").createSignedUrl(value, TTL_SECONDS);
    if (data?.signedUrl) {
      cache.set(value, { url: data.signedUrl, expiresAt: now + (TTL_SECONDS - 60) * 1000 });
      return data.signedUrl;
    }
    return null;
  })().finally(() => inflight.delete(value));
  inflight.set(value, p);
  return p;
}

export function invalidateAvatarCache(value?: string | null) {
  if (value) cache.delete(value);
  else cache.clear();
}
