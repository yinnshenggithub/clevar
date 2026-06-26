"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Send, Paperclip, X, StickyNote } from "lucide-react";
import { replyToConversation, type ReplyState } from "@/lib/actions/inbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState<ReplyState, FormData>(
    (prev, fd) => replyToConversation(conversationId, prev, fd),
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");

  useEffect(() => {
    if (!pending && !state.error) {
      formRef.current?.reset();
      setFileName("");
    }
  }, [pending, state]);

  const isNote = mode === "note";

  return (
    <div className={cn("border-t border-border", isNote && "bg-amber-500/5")}>
      <div className="flex gap-1 px-3 pt-2">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "reply" ? "Reply" : "Internal note"}
          </button>
        ))}
      </div>

      {state.error && <p className="px-3 pt-2 text-xs text-destructive">{state.error}</p>}
      {fileName && (
        <div className="flex items-center gap-1 px-3 pt-2 text-xs text-muted-foreground">
          <Paperclip className="h-3 w-3" />
          {fileName}
          <button
            type="button"
            onClick={() => {
              if (fileRef.current) fileRef.current.value = "";
              setFileName("");
            }}
            aria-label="Remove attachment"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <form ref={formRef} action={formAction} className="flex items-end gap-2 p-3">
        <input type="hidden" name="kind" value={mode} />
        {!isNote && (
          <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input hover:bg-accent">
            <Paperclip className="h-4 w-4" />
            <input
              ref={fileRef}
              type="file"
              name="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </label>
        )}
        <Textarea
          name="body"
          rows={1}
          placeholder={isNote ? "Add an internal note (not sent to the customer)…" : "Type a reply or attach a file…"}
          className="max-h-32 min-h-[40px] flex-1 resize-none"
        />
        <Button type="submit" size="icon" disabled={pending} aria-label={isNote ? "Save note" : "Send"}>
          {isNote ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
