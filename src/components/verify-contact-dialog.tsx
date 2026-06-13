import { useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parseQrPayload, markVerified } from "@/lib/verification";
import { addVerifiedContact, lookupProfileById } from "@/lib/contacts.functions";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Member = {
  user_id: string;
  display_name: string;
  public_key: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  /** Contacts in this conversation we may verify (excludes self). */
  candidates: Member[];
  /** Called after a successful local match + DB write. */
  onVerified?: (contactUserId: string) => void;
};

type Result =
  | { kind: "idle" }
  | { kind: "match"; name: string }
  | { kind: "mismatch"; reason: string };

export function VerifyContactDialog({
  open,
  onOpenChange,
  ownerId,
  candidates,
  onVerified,
}: Props) {
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const addContact = useServerFn(addVerifiedContact);
  const lookupProfile = useServerFn(lookupProfileById);

  function reset() {
    setResult({ kind: "idle" });
  }

  async function handleScan(rawValues: { rawValue: string }[]) {
    if (busy || result.kind !== "idle") return;
    const raw = rawValues[0]?.rawValue;
    if (!raw) return;
    const payload = parseQrPayload(raw);
    if (!payload) {
      setResult({ kind: "mismatch", reason: "Onbekende QR-code." });
      return;
    }
    let candidate = candidates.find((c) => c.user_id === payload.uid) ?? null;
    if (!candidate) {
      // Fallback: contact onbekend in deze context — haal profiel via server op.
      const prof = await lookupProfile({ data: { user_id: payload.uid } });
      if (!prof.found) {
        setResult({
          kind: "mismatch",
          reason: "Deze QR hoort niet bij een gebruiker die ik ken.",
        });
        return;
      }
      candidate = {
        user_id: prof.user_id,
        display_name: prof.display_name,
        public_key: prof.public_key,
      };
    }
    if (!candidate.public_key) {
      setResult({
        kind: "mismatch",
        reason: "Deze contact heeft (nog) geen sleutel.",
      });
      return;
    }
    // LOKALE vergelijking — server speelt hier geen rol.
    if (candidate.public_key !== payload.pk) {
      setResult({
        kind: "mismatch",
        reason:
          "De gescande sleutel komt NIET overeen met de sleutel die de app voor dit contact heeft. Doe het later opnieuw — onderbreek het gesprek bij twijfel.",
      });
      return;
    }
    setBusy(true);
    try {
      await markVerified(ownerId, candidate.user_id, candidate.public_key);
      // En direct ook toevoegen als contact (idempotent). De server bevestigt
      // de verificatie NIET — die is al lokaal gebeurd.
      try {
        await addContact({
          data: { contact_user_id: candidate.user_id, public_key: candidate.public_key },
        });
      } catch (e) {
        console.warn("addVerifiedContact", e);
      }
      setResult({ kind: "match", name: candidate.display_name });
      onVerified?.(candidate.user_id);
      toast.success(`${candidate.display_name} is geverifieerd en toegevoegd`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Opslaan mislukt";
      setResult({ kind: "mismatch", reason: msg });
    } finally {
      setBusy(false);
    }
  }


  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Contact verifiëren</DialogTitle>
          <DialogDescription>
            Vraag je gesprekspartner om in zijn/haar Profiel de QR-code te openen,
            en scan die hier. De vergelijking gebeurt alleen op dit toestel —
            de server doet er niet aan mee.
          </DialogDescription>
        </DialogHeader>

        {result.kind === "idle" && (
          <div className="rounded-md overflow-hidden bg-muted">
            <Scanner
              onScan={handleScan}
              onError={(e) => {
                // eslint-disable-next-line no-console
                console.warn("Scanner error", e);
              }}
              constraints={{ facingMode: "environment" }}
              styles={{ container: { width: "100%" } }}
            />
          </div>
        )}

        {result.kind === "match" && (
          <div className="flex items-start gap-2 rounded-md bg-primary/10 text-primary p-3">
            <ShieldCheck className="w-5 h-5 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Sleutels komen overeen</div>
              <div>{result.name} is nu geverifieerd op dit toestel.</div>
            </div>
          </div>
        )}

        {result.kind === "mismatch" && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3">
            <ShieldAlert className="w-5 h-5 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Geen match</div>
              <div>{result.reason}</div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {result.kind !== "idle" && (
            <Button variant="outline" onClick={reset}>
              Opnieuw scannen
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Sluiten</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
