"use client";

import { useActionState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { replyToConversation, type ReplyState } from "@/lib/actions/inbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState<ReplyState, FormData>(
    (prev, fd) => replyToConversation(conversationId, prev, fd),
    {},
  );
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && !state.error) ref.current?.reset();
  }, [pending, state]);

  return (
    <div className="border-t border-border">
      {state.error && <p className="px-3 pt-2 text-xs text-destructive">{state.error}</p>}
      <form ref={ref} action={formAction} className="flex items-end gap-2 p-3">
        <Textarea
          name="body"
          rows={1}
          required
          placeholder="Type a reply…"
          className="max-h-32 min-h-[40px] flex-1 resize-none"
        />
        <Button type="submit" size="icon" disabled={pending} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
