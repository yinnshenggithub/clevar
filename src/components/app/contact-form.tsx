"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const PHONE_REGIONS = ["US", "GB", "MY", "SG", "AU", "IN", "CA", "DE", "FR", "AE", "ID", "PH"];

export interface ContactDefaults {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
}

export function ContactForm({
  action,
  companies,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  companies: { id: string; name: string }[];
  defaults?: ContactDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" defaultValue={defaults?.firstName ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" defaultValue={defaults?.lastName ?? ""} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={defaults?.email ?? ""} placeholder="person@company.com" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={defaults?.phone ?? ""} placeholder="+60 12-345 6789 or local" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phoneRegion">Country</Label>
          <Select id="phoneRegion" name="phoneRegion" defaultValue="">
            <option value="">Auto (+code)</option>
            {PHONE_REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="jobTitle">Job title</Label>
          <Input id="jobTitle" name="jobTitle" defaultValue={defaults?.jobTitle ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyId">Company</Label>
          <Select id="companyId" name="companyId" defaultValue={defaults?.companyId ?? ""}>
            <option value="">No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input name="newCompanyName" placeholder="…or type a new company to create it" />
        </div>
      </div>

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
