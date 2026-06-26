"use client";

import { useTransition } from "react";
import type { ConversationStatus } from "@prisma/client";
import { setConversationStatus } from "@/lib/actions/inbox";
import { Button } from "@/components/ui/button";

export function ConversationStatusButton({
  conversationId,
  status,
}: {
  conversationId: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const next: ConversationStatus = status === "OPEN" ? "CLOSED" : "OPEN";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(() => void setConversationStatus(conversationId, next))}
    >
      {status === "OPEN" ? "Close" : "Reopen"}
    </Button>
  );
}
