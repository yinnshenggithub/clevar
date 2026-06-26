"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCategory, type HelpState } from "@/lib/actions/help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CategoryForm() {
  const [state, formAction, pending] = useActionState<HelpState, FormData>(createCategory, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="flex gap-2">
      <Input name="name" required placeholder="New category (e.g. Getting started)" className="flex-1" />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}
