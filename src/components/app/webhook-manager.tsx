"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { createWebhook, deleteWebhook, type WebhookState } from "@/lib/actions/webhooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Hook = { id: string; url: string; events: string[] };

export function WebhookManager({ hooks, events }: { hooks: Hook[]; events: readonly string[] }) {
  const [state, formAction, pending] = useActionState<WebhookState, FormData>(createWebhook, {});
  const [deleting, startDelete] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      <form ref={ref} action={formAction} className="space-y-3">
        <Input name="url" placeholder="https://your-endpoint.com/clevar" />
        <div className="flex flex-wrap gap-3">
          {events.map((e) => (
            <label key={e} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="events" value={e} className="h-4 w-4" defaultChecked />
              <code className="text-xs">{e}</code>
            </label>
          ))}
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-600">Webhook added.</p>}
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Adding…" : "Add webhook"}
        </Button>
      </form>

      {hooks.length > 0 && (
        <ul className="divide-y divide-border">
          {hooks.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{h.url}</div>
                <div className="text-xs text-muted-foreground">{h.events.join(", ")}</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={deleting}
                className="text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (window.confirm("Delete this webhook?")) startDelete(() => void deleteWebhook(h.id));
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Payloads are POSTed as JSON with an <code>X-Clevar-Signature</code> (HMAC-SHA256 of the body using the per-webhook secret).
      </p>
    </div>
  );
}
