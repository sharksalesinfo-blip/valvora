import { useState } from "react";

// Blokpagina die afgaat als een fork tegen de originele valvora-backend draait.
// Twee lezers:
//   - "user"     → kringlid dat per ongeluk op een verkeerd opgezette fork
//                  belandt. Krijgt mensentaal en advies om de uitnodiger te
//                  vragen, zónder technische jargon.
//   - "operator" → wie deze fork heeft uitgerold. Krijgt concrete instructies.
// De user-view is default; de operator-view zit één klik verder weg.

export function ForkMisconfigScreen() {
  const [view, setView] = useState<"user" | "operator">("user");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        {view === "user" ? (
          <>
            <h1 className="text-xl font-semibold">Deze instance is niet correct opgezet</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Je bent op een kopie van valvora terechtgekomen die nog niet helemaal is
              ingericht. De app zelf is niet kapot — degene die deze kopie draait moet
              hem nog koppelen aan een eigen backend.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Wat je nu kunt doen: neem contact op met de persoon die je deze link of
              uitnodiging stuurde. Zeg dat de fork nog tegen de oorspronkelijke
              backend draait en moet worden afgemaakt. Tot die tijd kun je hier niet
              veilig inloggen.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Wil je de officiële valvora gebruiken? Die staat op{" "}
              <a
                href="https://valvora.nl"
                className="underline underline-offset-2"
                rel="noopener noreferrer"
              >
                valvora.nl
              </a>
              .
            </p>
            <button
              type="button"
              onClick={() => setView("operator")}
              className="mt-6 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Ik heb deze fork zelf opgezet — wat moet ik aanpassen?
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Fork draait tegen de originele backend</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Je build wijst naar de Supabase-URL van de officiële valvora-instance.
              Als je dit zo laat staan, maken jouw gebruikers accounts aan in
              andermans database. Fix dit voor je live gaat.
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
              <li>
                Maak een nieuw, leeg Supabase/Lovable Cloud-project.
              </li>
              <li>
                Overschrijf in <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code>:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_SUPABASE_URL</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_URL</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_PUBLISHABLE_KEY</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_SUPABASE_PROJECT_ID</code> en{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_PROJECT_ID</code>.
              </li>
              <li>
                Pas alle migraties toe, deploy de <code className="rounded bg-muted px-1 py-0.5 text-xs">notify</code> edge function,
                en zet eigen VAPID-secrets.
              </li>
              <li>
                Volledige checklist staat in{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">SECURITY.md</code> sectie 4.
              </li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              Ben jij de eigenaar van de officiële instance en zie je dit ten onrechte?
              Zet <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_IS_ORIGINAL_INSTANCE=true</code> in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code> en rebuild.
            </p>
            <button
              type="button"
              onClick={() => setView("user")}
              className="mt-6 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Terug naar de uitleg voor gebruikers
            </button>
          </>
        )}
      </div>
    </div>
  );
}
