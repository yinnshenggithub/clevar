"use client";

import { useChat, type Message } from "ai/react";
import { useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ChatBox({
  agentId,
  conversationId,
  initialMessages,
}: {
  agentId: string;
  conversationId: string;
  initialMessages: Message[];
}) {
  const { messages, input, handleInputChange, handleSubmit, status, error } = useChat({
    api: `/api/agents/${agentId}/chat`,
    id: conversationId,
    initialMessages,
    body: { conversationId },
  });

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-xl border border-border bg-card">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Start the conversation — ask your agent anything.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message.includes("402") || error.message.toLowerCase().includes("credit")
              ? "Out of AI credits for this period."
              : "Something went wrong. Check that an AI provider key is configured."}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
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
