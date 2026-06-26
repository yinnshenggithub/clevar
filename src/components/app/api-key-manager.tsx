"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { createApiKey, revokeApiKey, type ApiKeyState } from "@/lib/actions/api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Key = { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null };

export function ApiKeyManager({ keys, baseUrl }: { keys: Key[]; baseUrl: string }) {
  const [state, formAction, pending] = useActionState<ApiKeyState, FormData>(createApiKey, {});
  const [copied, setCopied] = useState(false);
  const [revoking, startRevoke] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.key) ref.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      {state.key && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Copy your key now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">{state.key}</code>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(state.key!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              aria-label="Copy key"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      <form ref={ref} action={formAction} className="flex gap-2">
        <Input name="name" placeholder="Key name (e.g. Zapier)" className="flex-1" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {keys.length > 0 && (
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  {k.name} <code className="ml-1 rounded bg-secondary px-1 text-xs text-muted-foreground">{k.prefix}…</code>
                </div>
                <div className="text-xs text-muted-foreground">
                  {k.revokedAt ? "Revoked" : k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "Never used"}
                </div>
              </div>
              {!k.revokedAt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={revoking}
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (window.confirm("Revoke this key? Apps using it will stop working.")) startRevoke(() => void revokeApiKey(k.id));
                  }}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Quick start</p>
        <code className="mt-1 block break-all">
          curl {baseUrl}/api/v1/contacts -H &quot;Authorization: Bearer YOUR_KEY&quot;
        </code>
        <p className="mt-2">Resources: <code>contacts</code>, <code>companies</code>, <code>deals</code> — GET (list, ?limit&amp;offset), GET /:id, POST.</p>
      </div>
    </div>
  );
}
