// Versleutelde-bericht envelope (v1)
// Alles dat inhoud is — tekst, bestandsnaam/type, coördinaten, geforward-vlag —
// zit binnen de plaintext die client-side wordt versleuteld via crypto_box.
// De server ziet hier dus niets van.

export type EnvelopeV1 =
  | { v: 1; type: "text"; text: string; fwd?: boolean }
  | {
      v: 1;
      type: "image" | "file";
      file: { key: string; nonce: string; mime: string; name?: string; size?: number };
      caption?: string;
      fwd?: boolean;
    }
  | {
      v: 1;
      type: "location";
      location: { lat: number; lng: number; acc?: number };
      fwd?: boolean;
    };

export type DecodedEnvelope =
  | { type: "text"; text: string; fwd?: boolean }
  | {
      type: "image" | "file";
      file: { key: string; nonce: string; mime: string; name?: string; size?: number };
      caption?: string;
      fwd?: boolean;
    }
  | { type: "location"; location: { lat: number; lng: number; acc?: number }; fwd?: boolean };

export function encodeEnvelope(env: EnvelopeV1): string {
  return JSON.stringify(env);
}

// Tolerant decoder: leest v1-envelopes én legacy text/image.
// legacy text = ruwe string
// legacy image = JSON {key, nonce, mime?}
export function decodeEnvelope(
  plaintext: string,
  dbType: "text" | "image" | "file" | "location",
): DecodedEnvelope {
  try {
    const obj = JSON.parse(plaintext);
    if (obj && typeof obj === "object") {
      if (obj.v === 1 && typeof obj.type === "string") {
        return obj as DecodedEnvelope;
      }
      // legacy image
      if (typeof obj.key === "string" && typeof obj.nonce === "string") {
        return {
          type: "image",
          file: { key: obj.key, nonce: obj.nonce, mime: obj.mime ?? "image/jpeg" },
        };
      }
    }
  } catch {
    // niet-JSON → behandel als tekst
  }
  if (dbType === "text") return { type: "text", text: plaintext };
  // fallback
  return { type: "text", text: plaintext };
}
