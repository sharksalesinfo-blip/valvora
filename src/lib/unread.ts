// Per-conversation "last read" timestamp, opgeslagen in localStorage.
// Bewust client-only: server houdt geen read-state bij (privacy/metadata).
const PREFIX = "last-read:";

export function getLastRead(conversationId: string): string | null {
  try {
    return localStorage.getItem(PREFIX + conversationId);
  } catch {
    return null;
  }
}

export function setLastRead(conversationId: string, iso?: string): void {
  try {
    localStorage.setItem(PREFIX + conversationId, iso ?? new Date().toISOString());
    window.dispatchEvent(new CustomEvent("unread-changed", { detail: { conversationId } }));
  } catch {}
}

export function isUnread(
  conversationId: string,
  lastMessageAt: string | null | undefined,
  lastSenderId: string | null | undefined,
  myUserId: string,
): boolean {
  if (!lastMessageAt) return false;
  if (lastSenderId && lastSenderId === myUserId) return false;
  const read = getLastRead(conversationId);
  if (!read) return true;
  return new Date(lastMessageAt).getTime() > new Date(read).getTime();
}
