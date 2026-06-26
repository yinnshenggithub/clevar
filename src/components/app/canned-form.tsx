"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCanned, type CannedState } from "@/lib/actions/canned";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CannedForm() {
  const [state, formAction, pending] = useActionState<CannedState, FormData>(createCanned, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cr-shortcode">Shortcode</Label>
          <Input id="cr-shortcode" name="shortcode" required placeholder="greeting" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cr-title">Title</Label>
          <Input id="cr-title" name="title" required placeholder="Welcome greeting" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cr-content">Message</Label>
        <Textarea id="cr-content" name="content" rows={3} required placeholder="Hi! Thanks for reaching out — how can we help?" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Saved.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add canned response"}
      </Button>
    </form>
  );
}
