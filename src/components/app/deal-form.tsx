"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/actions/deals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { CustomFieldset, type RecordFieldDef } from "@/components/app/custom-fieldset";

export interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

export interface DealDefaults {
  title?: string | null;
  amount?: string | null;
  currency?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  companyId?: string | null;
  expectedCloseAt?: string | null;
}

export function DealForm({
  action,
  pipelines,
  companies,
  contacts = [],
  defaultContactIds = [],
  defaults,
  submitLabel,
  customFields = [],
  customFieldDefaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  pipelines: PipelineOption[];
  companies: { id: string; name: string }[];
  contacts?: { id: string; label: string }[];
  defaultContactIds?: string[];
  defaults?: DealDefaults;
  submitLabel: string;
  customFields?: RecordFieldDef[];
  customFieldDefaults?: Record<string, unknown>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();

  const initialPipeline = defaults?.pipelineId ?? pipelines[0]?.id ?? "";
  const [pipelineId, setPipelineId] = useState(initialPipeline);
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">Deal title</Label>
        <Input id="title" name="title" required defaultValue={defaults?.title ?? ""} placeholder="Acme — annual plan" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={defaults?.amount ?? ""} placeholder="10000" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" maxLength={3} defaultValue={defaults?.currency ?? "USD"} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pipelineId">Pipeline</Label>
          <Select
            id="pipelineId"
            name="pipelineId"
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="stageId">Stage</Label>
          <Select id="stageId" name="stageId" defaultValue={defaults?.stageId ?? stages[0]?.id ?? ""}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="expectedCloseAt">Expected close</Label>
          <Input
            id="expectedCloseAt"
            name="expectedCloseAt"
            type="date"
            defaultValue={defaults?.expectedCloseAt ?? ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Contacts</Label>
        <MultiSelect name="contactIds" options={contacts} defaultValue={defaultContactIds} emptyText="No contacts yet" />
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
