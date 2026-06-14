// Fork-guard: voorkomt dat een fork per ongeluk tegen de originele valvora-backend
// draait. Een README-instructie wordt overgeslagen; een blokpagina niet.
//
// Hoe het werkt:
// - ORIGINAL_INSTANCE_SUPABASE_URL is de URL van de officiële instance.
// - Als VITE_SUPABASE_URL daaraan gelijk is en VITE_IS_ORIGINAL_INSTANCE niet
//   op "true" staat, draait je build vrijwel zeker tegen de verkeerde backend.
// - De officiële instance zet VITE_IS_ORIGINAL_INSTANCE=true in zijn .env en
//   wordt nooit geblokkeerd.
// - Een legitieme forker zet zijn eigen VITE_SUPABASE_URL en draait verder
//   zonder ooit deze check te zien.

export const ORIGINAL_INSTANCE_SUPABASE_URL = "https://xxddqmrwejrkpmpzlbtg.supabase.co";

export function isMisconfiguredFork(): boolean {
  const currentUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const isOriginal = import.meta.env.VITE_IS_ORIGINAL_INSTANCE === "true";
  if (isOriginal) return false;
  if (!currentUrl) return false;
  return currentUrl.replace(/\/+$/, "") === ORIGINAL_INSTANCE_SUPABASE_URL;
}
