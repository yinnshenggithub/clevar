"use client";

import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export function DeleteButton({
  action,
  label = "Delete",
  confirmText = "Delete this record? This cannot be undone.",
}: {
  action: () => Promise<void>;
  label?: string;
  confirmText?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <Button type="submit" variant="outline" className="gap-2 text-destructive hover:bg-destructive/10">
        <Trash2 className="h-4 w-4" />
        {label}
      </Button>
    </form>
  );
}
