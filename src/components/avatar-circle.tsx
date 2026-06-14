import { useEffect, useState } from "react";
import { initials } from "@/lib/format";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: number; // px
  className?: string;
};

/**
 * Toont een avatarafbeelding indien beschikbaar, anders een initiaal-cirkel.
 * Avatars zijn profielinfo (niet versleuteld) en zichtbaar voor gebruikers
 * binnen je profile-visibility scope (zie RLS op profiles).
 */
export function AvatarCircle({ name, avatarUrl, size = 48, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!avatarUrl) {
      setUrl(null);
      return;
    }
    void resolveAvatarUrl(avatarUrl).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  const style = { width: size, height: size } as const;

  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        className={cn("rounded-full object-cover shrink-0 bg-muted", className)}
      />
    );
  }
  return (
    <div
      style={style}
      className={cn(
        "rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold shrink-0",
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}
