"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomFieldset, type RecordFieldDef } from "@/components/app/custom-fieldset";

export interface CompanyDefaults {
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
}

export function CompanyForm({
  action,
  defaults,
  submitLabel,
  customFields = [],
  customFieldDefaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: CompanyDefaults;
  submitLabel: string;
  customFields?: RecordFieldDef[];
  customFieldDefaults?: Record<string, unknown>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Company name</Label>
        <Input id="name" name="name" required defaultValue={defaults?.name ?? ""} placeholder="Acme Inc." />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="domain">Website / domain</Label>
          <Input id="domain" name="domain" defaultValue={defaults?.domain ?? ""} placeholder="acme.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" name="industry" defaultValue={defaults?.industry ?? ""} placeholder="Software" />
        </div>
      </div>

      {customFields.length > 0 && (
        <div className="space-y-5 border-t border-border pt-5">
          <p className="text-sm font-semibold">Custom fields</p>
          <CustomFieldset fields={customFields} defaults={customFieldDefaults} />
        </div>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
