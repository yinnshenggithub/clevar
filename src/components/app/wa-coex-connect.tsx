"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  completeEmbeddedSignup,
  updateWhatsAppChannel,
  type ChannelState,
} from "@/lib/actions/channels";

/* eslint-disable @typescript-eslint/no-explicit-any */

const GRAPH_VERSION = "v21.0";

/** Loads and initializes the Meta JS SDK once; resolves with window.FB. */
function loadFbSdk(appId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.FB) return resolve(w.FB);
    // Blocked/hung script (CSP, extensions, partial response) must surface as
    // an error, not a forever-disabled button.
    const deadline = setTimeout(() => reject(new Error("Timed out loading Meta's sign-in script")), 15000);
    w.fbAsyncInit = () => {
      clearTimeout(deadline);
      w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(w.FB);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      s.async = true;
      s.defer = true;
      s.onerror = () => {
        clearTimeout(deadline);
        reject(new Error("Couldn't load Meta's sign-in script"));
      };
      document.head.appendChild(s);
    }
  });
}

interface EsSession {
  wabaId?: string;
  phoneNumberId?: string;
  coex: boolean;
  canceled?: boolean;
}

type Phase = "idle" | "connecting" | "finishing" | "done" | "error";

/**
 * "Connect WhatsApp Business app" — launches Meta's Embedded Signup popup
 * (coexistence flow: the owner keeps their existing number and phone app),
 * captures the session result via postMessage, and finishes server-side.
 */
export function WaCoexConnect({ appId, configId }: { appId: string; configId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connectedNumber, setConnectedNumber] = useState<string | null>(null);
  const [, startFinish] = useTransition();
  const sessionRef = useRef<EsSession | null>(null);
  const sdkRef = useRef<Promise<any> | null>(null);

  // Preload the SDK so FB.login runs inside the click gesture (popup blockers).
  useEffect(() => {
    sdkRef.current = loadFbSdk(appId);
    sdkRef.current.catch(() => {
      /* surfaced on click */
    });
  }, [appId]);

  // Embedded Signup reports progress by postMessage from the popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      let host = "";
      try {
        host = new URL(event.origin).hostname; // origin can be "null" (opaque) — not parseable
      } catch {
        return;
      }
      if (!/(^|\.)facebook\.com$/.test(host)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
          sessionRef.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id, coex: true };
        } else if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
          sessionRef.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id, coex: false };
        } else if (data.event === "CANCEL") {
          sessionRef.current = { coex: false, canceled: true };
        }
      } catch {
        /* other frames post non-JSON messages */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** The FB.login callback can fire before the FINISH postMessage lands. */
  const waitForSession = async (): Promise<EsSession | null> => {
    for (let i = 0; i < 20; i++) {
      if (sessionRef.current) return sessionRef.current;
      await new Promise((r) => setTimeout(r, 250));
    }
    return sessionRef.current;
  };

  const connect = () => {
    if (phase === "connecting" || phase === "finishing") return; // one popup at a time
    setError(null);
    setWarning(null);
    sessionRef.current = null;
    setPhase("connecting");
    // Safari/Firefox only allow the popup when window.open runs synchronously
    // in the click's call stack — so call FB.login without awaiting when the
    // preloaded SDK is ready, and only fall back to the promise on a cold path.
    const ready = (window as any).FB;
    if (ready) {
      launch(ready);
      return;
    }
    (sdkRef.current ?? (sdkRef.current = loadFbSdk(appId)))
      .then((FB) => launch(FB))
      .catch(() => {
        sdkRef.current = null; // let the next click re-attempt the load
        setPhase("error");
        setError("Couldn't load Meta's sign-in script. Disable ad blockers for this page and try again.");
      });
  };

  const launch = (FB: any) => {
    FB.login(
      (response: any) => {
        const code: string | undefined = response?.authResponse?.code;
        startFinish(async () => {
          const session = await waitForSession();
          if (!code || !session?.wabaId) {
            setPhase(session?.canceled || !code ? "idle" : "error");
            if (!session?.canceled && code) setError("Meta didn't return the connected account. Please try again.");
            return;
          }
          setPhase("finishing");
          const res = await completeEmbeddedSignup({
            code,
            wabaId: session.wabaId,
            phoneNumberId: session.phoneNumberId,
            coex: session.coex,
          });
          if (res.error) {
            setPhase("error");
            setError(res.error);
            return;
          }
          setWarning(res.warning ?? null);
          setConnectedNumber(res.displayPhoneNumber ?? null);
          setPhase("done");
          router.refresh();
        });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  };

  if (phase === "done") {
    return (
      <div className="space-y-2">
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4" />
          Connected{connectedNumber ? ` — ${connectedNumber}` : ""}. Syncing your chats and contacts — this can take a
          few minutes.
        </div>
        {warning && (
          <p role="alert" className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {warning}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPhase("idle");
            setError(null);
            setWarning(null);
            setConnectedNumber(null);
          }}
        >
          Connect another number
        </Button>
      </div>
    );
  }

  const busy = phase === "connecting" || phase === "finishing";
  return (
    <div className="rounded-lg border border-border p-3" aria-live="polite">
      <Button onClick={connect} disabled={busy} className="gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <MessageSquareText className="h-4 w-4" />}
        {phase === "finishing" ? "Finishing setup…" : phase === "connecting" ? "Waiting for Meta…" : "Connect WhatsApp Business app"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Keep your existing number and keep using the app on your phone — a Meta window walks you through a QR scan, and
        up to 6 months of chats sync into your inbox.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Display name + auto-reply agent settings for one connected number. */
export function WaChannelSettings({
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
  const [state, formAction, pending] = useActionState<ChannelState, FormData>(
    (prev, fd) => updateWhatsAppChannel(channelId, prev, fd),
    {},
  );
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-1">
        <Label htmlFor={`wa-name-${channelId}`}>Display name</Label>
        <Input id={`wa-name-${channelId}`} name="displayName" defaultValue={displayName} className="h-9" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`wa-agent-${channelId}`}>Auto-reply agent</Label>
        <Select id={`wa-agent-${channelId}`} name="autoReplyAgentId" defaultValue={autoReplyAgentId ?? ""} className="h-9">
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
