"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  requestWaWebCode,
  retryWaWebPairing,
  startWaWebPairing,
  updateWaWebChannel,
  type WaWebUpdateState,
} from "@/lib/actions/wa-web";

type Phase = "idle" | "starting" | "scan_qr" | "working" | "failed";

/**
 * Inline pairing wizard: start a gateway session, poll for the QR, flip to
 * connected. Pairing-code entry is the no-camera fallback. Pass `resume` to
 * relink an existing (signed-out) channel row instead of creating a new one.
 */
export function WaWebConnect({ resume }: { resume?: { channelId: string } } = {}) {
  const router = useRouter();
  const [channelId, setChannelId] = useState<string | null>(resume?.channelId ?? null);
  const [phase, setPhase] = useState<Phase>(resume ? "starting" : "idle");
  const [qr, setQr] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, startStart] = useTransition();

  // Pairing-code path
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [requestingCode, startCode] = useTransition();

  const polling = channelId && (phase === "starting" || phase === "scan_qr");

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/wa-web/status/${channelId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { status?: string; qr?: string | null; phoneNumber?: string | null };
        if (cancelled) return;
        setQr(j.qr ?? null);
        if (j.phoneNumber) setPhoneNumber(j.phoneNumber);
        if (j.status === "working") setPhase("working");
        else if (j.status === "failed" || j.status === "stopped") setPhase("failed");
        else if (j.status === "scan_qr") setPhase("scan_qr");
      } catch {
        /* transient poll errors are fine */
      }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [channelId, polling]);

  // Once connected, refresh the page so the linked number renders as a row.
  useEffect(() => {
    if (phase !== "working") return;
    const t = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(t);
  }, [phase, router]);

  const begin = () => {
    setError(null);
    startStart(async () => {
      const res = await startWaWebPairing();
      if (res.error) setError(res.error);
      else if (res.channelId) {
        setChannelId(res.channelId);
        setPhase("starting");
        setQr(null);
        setCode(null);
      }
    });
  };

  const retry = () => {
    if (!channelId) return begin();
    setError(null);
    setCode(null);
    startStart(async () => {
      const res = await retryWaWebPairing(channelId);
      if (res.error) setError(res.error);
      else {
        setPhase("starting");
        setQr(null);
      }
    });
  };

  // Resume mode: kick off the restart automatically so the QR appears.
  useEffect(() => {
    if (resume) retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCode = () => {
    if (!channelId) return;
    setCodeError(null);
    startCode(async () => {
      const res = await requestWaWebCode(channelId, phone);
      if (res.error) setCodeError(res.error);
      else setCode(res.code ?? null);
    });
  };

  if (phase === "idle") {
    return (
      <div className="rounded-lg border border-border p-3">
        <Button onClick={begin} disabled={starting} className="gap-2">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
          {starting ? "Starting…" : "Link a number"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Works with the WhatsApp and WhatsApp Business apps — scan a QR from your phone, no Meta developer account
          needed.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (phase === "working") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 className="h-4 w-4" />
        Connected{phoneNumber ? ` — ${phoneNumber}` : ""}. Syncing your inbox…
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <p role="alert" className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" /> Pairing didn&apos;t complete — the code expired or the link failed.
        </p>
        <Button onClick={retry} disabled={starting} variant="outline" size="sm" className="gap-2">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Generate a new
          code
        </Button>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">Still not linking?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Update WhatsApp to the latest version on your phone.</li>
            <li>Turn off any VPN on the phone and check its clock is set automatically.</li>
            <li>WhatsApp allows up to 4 linked devices — unlink one if you&apos;re at the limit.</li>
          </ul>
        </details>
      </div>
    );
  }

  // starting / scan_qr
  return (
    <div className="space-y-4 rounded-lg border border-border p-4" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="relative mx-auto h-[184px] w-[184px] shrink-0 rounded-xl bg-white p-3 shadow-card">
          {/* scanner-frame corners */}
          <span aria-hidden className="absolute -left-1 -top-1 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-primary" />
          <span aria-hidden className="absolute -right-1 -top-1 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-primary" />
          <span aria-hidden className="absolute -bottom-1 -left-1 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-primary" />
          <span aria-hidden className="absolute -bottom-1 -right-1 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-primary" />
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="WhatsApp pairing QR code" className="h-full w-full" />
          ) : (
            <div className="flex h-full w-full animate-pulse items-center justify-center rounded-md bg-secondary motion-reduce:animate-none">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
            </div>
          )}
        </div>
        <div className="text-sm">
          <p className="font-medium">Scan with your phone</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Open WhatsApp or WhatsApp Business</li>
            <li>
              Tap <b>Settings → Linked devices</b>
            </li>
            <li>
              Tap <b>Link a device</b> and point the camera here
            </li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">The code refreshes automatically — no need to reload.</p>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        {code ? (
          <div className="space-y-1">
            <p className="text-sm">
              On your phone tap <b>Link with phone number instead</b> and enter:
            </p>
            <p className="font-display text-2xl font-bold tracking-[0.3em]">
              {code.replace(/[^A-Za-z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Get an 8-character code to type on your phone instead.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+60 12 345 6789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 w-48"
                aria-label="WhatsApp phone number with country code"
              />
              <Button onClick={getCode} disabled={requestingCode || !phone.trim()} variant="outline" size="sm">
                {requestingCode ? "Getting code…" : "Get code"}
              </Button>
            </div>
            {codeError && (
              <p role="alert" className="text-sm text-destructive">
                {codeError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Relink" control for a signed-out number — mounts the pairing wizard on click. */
export function WaWebRelink({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <WaWebConnect resume={{ channelId }} />;
  return (
    <Button onClick={() => setOpen(true)} variant="outline" size="sm" className="gap-2">
      <RefreshCw className="h-3.5 w-3.5" /> Relink
    </Button>
  );
}

/** Display name + auto-reply agent settings for one linked number. */
export function WaWebChannelSettings({
  channelId,
  displayName,
  autoReplyAgentId,
  agents,
}: {
  channelId: string;
  displayName: string;
  autoReplyAgentId: string | null;
  agents: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<WaWebUpdateState, FormData>(
    (prev, fd) => updateWaWebChannel(channelId, prev, fd),
    {},
  );
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-1">
        <Label htmlFor={`ww-name-${channelId}`}>Display name</Label>
        <Input id={`ww-name-${channelId}`} name="displayName" defaultValue={displayName} className="h-9" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`ww-agent-${channelId}`}>Auto-reply agent</Label>
        <Select id={`ww-agent-${channelId}`} name="autoReplyAgentId" defaultValue={autoReplyAgentId ?? ""} className="h-9">
          <option value="">No auto-reply</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {state.error}
        </p>
      )}
      {state.ok && <p className="text-sm text-emerald-600 sm:col-span-3">Saved.</p>}
    </form>
  );
}
