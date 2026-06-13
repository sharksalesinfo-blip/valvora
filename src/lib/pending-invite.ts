const KEY = "pending_invite_token";

export function rememberPendingInvite(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // ignore
  }
}

export function takePendingInvite(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v) localStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}

export function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/join?code=${token}`;
  return `${window.location.origin}/join?code=${token}`;
}
