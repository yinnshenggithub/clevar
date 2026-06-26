"use client";

import { useActionState } from "react";
import { importCsv, type ImportState } from "@/lib/actions/import";
import { Button } from "@/components/ui/button";

export function ImportForm({ object }: { object: string }) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    (prev, fd) => importCsv(object, prev, fd),
    {},
  );

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import CSV"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {state.result && (
        <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-4 text-sm">
          <p className="font-medium">
            Imported {state.result.created} · skipped {state.result.skipped} (already existed) ·{" "}
            {state.result.errorCount} error{state.result.errorCount === 1 ? "" : "s"}
          </p>
          {state.result.truncated && (
            <p className="text-muted-foreground">
              Only the first 2,000 rows were processed ({state.result.total} in file).
            </p>
          )}
          {state.result.errors.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-destructive">Rows with errors:</p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto text-muted-foreground">
                {state.result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
