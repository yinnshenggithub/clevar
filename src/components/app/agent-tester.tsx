"use client";

import { useChat, type Message } from "ai/react";
import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Zap, Settings2 } from "lucide-react";
import { firstMatchingRule, ruleNote, type AgentRule } from "@/lib/agent-rule-match";
import { MODEL_OPTIONS } from "@/lib/ai-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
}

function prettyTool(name: string) {
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function AgentTester({
  agentId,
  defaultModel,
  rules,
}: {
  agentId: string;
  defaultModel: string;
  rules: AgentRule[];
}) {
  const { messages, input, setInput, handleInputChange, append, setMessages, status, error } = useChat({
    api: `/api/agents/${agentId}/preview`,
  });

  const [model, setModel] = useState(defaultModel);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  // Live preview of which if-then rule the *current* draft message would trigger.
  const pending = firstMatchingRule(rules, input.trim());

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const matched = firstMatchingRule(rules, text);

    // Handoff mirrors production: the AI is unassigned and a human takes over, so
    // the agent does NOT reply. Show what the team would see instead of calling the model.
    if (matched && matched.action === "handoff") {
      setMessages([
        ...messages,
        { id: uid(), role: "user", content: text },
        {
          id: uid(),
          role: "assistant",
          content: `🤝 Handoff triggered — this conversation would be routed to a human teammate and the AI would stop replying.\n\nInternal note logged for the team:\n“${ruleNote(matched)}”`,
        },
      ]);
      setInput("");
      return;
    }

    // Note rules don't stop the AI; the live chip already surfaced it. Send normally,
    // always with the currently selected model.
    append({ role: "user", content: text }, { body: { model } });
    setInput("");
  }

  function reset() {
    setMessages([]);
    setInput("");
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Test model</span>
          <Select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-8 w-auto py-0 text-xs"
            aria-label="Test model"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      {/* Transcript */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Send a message to test the live response from your saved configuration.
          </p>
        )}
        {messages.map((m) => {
          const tools = m.role === "assistant" ? m.toolInvocations ?? [] : [];
          return (
            <div key={m.id} className={cn("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}>
              {tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((t) => (
                    <span
                      key={t.toolCallId}
                      className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:text-violet-300"
                    >
                      <Settings2 className="h-3 w-3" />
                      {prettyTool(t.toolName)}
                    </span>
                  ))}
                </div>
              )}
              {m.content && (
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.id !== "greeting" && m.content.startsWith("🤝")
                        ? "border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {m.content}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-secondary px-4 py-2 text-sm text-muted-foreground">…</div>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message.includes("402") || error.message.toLowerCase().includes("credit")
              ? "Out of AI credits for this period."
              : "Couldn't get a reply. Check that an AI provider key is configured for this workspace."}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Live rule chip */}
      {pending && (
        <div className="border-t border-border px-3 pt-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              pending.action === "handoff"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
            )}
          >
            <Zap className="h-3 w-3" />
            {pending.action === "handoff"
              ? "This message would hand off to a human"
              : "This message would add an internal note"}
          </span>
        </div>
      )}

      {/* Composer */}
      <form onSubmit={send} className="flex gap-2 p-3">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Message your agent…"
          disabled={busy}
          autoFocus
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
