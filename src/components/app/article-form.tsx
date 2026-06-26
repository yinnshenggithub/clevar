"use client";

import { useActionState } from "react";
import type { HelpState } from "@/lib/actions/help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ArticleForm({
  action,
  categories,
  defaults,
  submitLabel,
}: {
  action: (prev: HelpState, formData: FormData) => Promise<HelpState>;
  categories: { id: string; name: string }[];
  defaults?: { title: string; body: string; categoryId: string | null; published: boolean };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<HelpState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required defaultValue={defaults?.title ?? ""} placeholder="How to connect WhatsApp" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="categoryId">Category</Label>
          <Select id="categoryId" name="categoryId" defaultValue={defaults?.categoryId ?? ""}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="published" defaultChecked={defaults?.published ?? false} className="h-4 w-4" />
          Published (visible on public help center)
        </label>
      </div>
      <div className="space-y-2">
        <Label htmlFor="body">Content</Label>
        <Textarea id="body" name="body" rows={14} required defaultValue={defaults?.body ?? ""} placeholder="Write the article…" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Saved.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
