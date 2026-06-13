import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { buildQrPayload } from "@/lib/verification";

type Props = {
  userId: string;
  publicKey: string;
  size?: number;
};

export function KeyQrCode({ userId, publicKey, size = 220 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !ref.current) return;
    QRCode.toCanvas(ref.current, buildQrPayload(userId, publicKey), {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    }).catch((e) => setErr(e?.message ?? "QR-code mislukt"));
  }, [userId, publicKey, size]);

  if (!publicKey) {
    return (
      <div className="text-xs text-muted-foreground">(geen sleutel)</div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={ref} className="rounded-md bg-white p-2" aria-label="QR-code met jouw publieke sleutel" />
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}
