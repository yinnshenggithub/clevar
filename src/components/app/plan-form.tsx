"use client";

import { useActionState } from "react";
import { setPlan, type PlanState } from "@/lib/actions/billing";
import { PLANS, PLAN_LABELS, PLAN_LIMITS } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function PlanForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState<PlanState, FormData>(setPlan, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <Select name="plan" defaultValue={current} className="w-48">
        {PLANS.map((p) => (
          <option key={p} value={p}>
            {PLAN_LABELS[p]} — {PLAN_LIMITS[p].toLocaleString()} credits/mo
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change plan"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="w-full text-sm text-emerald-600">Plan updated.</p>}
    </form>
  );
}
