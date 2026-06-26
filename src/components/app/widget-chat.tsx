"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { id: string; direction: string; body: string; at: string };

export function WidgetChat({
  publicKey,
  name,
  color,
  welcome,
}: {
  publicKey: string;
  name: string;
  color: string;
  welcome: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | null>(null);

  const api = (path: string) => `/api/widget/${encodeURIComponent(publicKey)}/${path}`;

  // Start (or resume) the conversation on mount.
  useEffect(() => {
    const storeKey = `clevar_v_${publicKey}`;
    const existing = typeof window !== "undefined" ? localStorage.getItem(storeKey) : null;
    (async () => {
      try {
        const res = await fetch(api("start"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ visitorId: existing }),
        });
        const data = await res.json();
        if (data.visitorId) {
          localStorage.setItem(storeKey, data.visitorId);
          setVisitorId(data.visitorId);
        }
        setConversationId(data.conversationId);
        setMessages(data.messages ?? []);
        lastAt.current = data.messages?.length ? data.messages[data.messages.length - 1].at : new Date(0).toISOString();
      } catch {
        /* offline */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // Poll for agent / AI replies.
  useEffect(() => {
    if (!conversationId || !visitorId) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(api(`poll?conversationId=${conversationId}&visitorId=${visitorId}&after=${encodeURIComponent(lastAt.current ?? "")}`));
        const data = await res.json();
        if (data.messages?.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = (data.messages as Msg[]).filter((m) => !seen.has(m.id));
            if (fresh.length) lastAt.current = fresh[fresh.length - 1].at;
            return [...prev, ...fresh];
          });
        }
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(id);
  }, [conversationId, visitorId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !conversationId || !visitorId || sending) return;
    setSending(true);
    setDraft("");
    const optimistic: Msg = { id: `tmp-${Date.now()}`, direction: "INBOUND", body, at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    lastAt.current = optimistic.at;
    try {
      await fetch(api("message"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, visitorId, body }),
      });
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: color }}>
        <span className="text-lg">💬</span>
        <span className="font-semibold">{name}</span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
        <div className="mr-auto max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
          {welcome}
        </div>
        {messages.map((m) => {
          const fromVisitor = m.direction === "INBOUND";
          return (
            <div
              key={m.id}
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${
                fromVisitor ? "ml-auto rounded-tr-sm text-white" : "mr-auto rounded-tl-sm bg-white text-slate-700"
              }`}
              style={fromVisitor ? { background: color } : undefined}
            >
              {m.body}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message…"
          className="h-10 flex-1 rounded-full border border-slate-300 px-4 text-sm outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white disabled:opacity-50"
          style={{ background: color }}
          aria-label="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
