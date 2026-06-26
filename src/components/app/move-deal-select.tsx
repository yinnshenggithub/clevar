"use client";

import { moveDealAction } from "@/lib/actions/deals";
import { Select } from "@/components/ui/select";

export function MoveDealSelect({
  dealId,
  stageId,
  stages,
}: {
  dealId: string;
  stageId: string;
  stages: { id: string; name: string }[];
}) {
  return (
    <form action={moveDealAction}>
      <input type="hidden" name="dealId" value={dealId} />
      <Select
        name="stageId"
        defaultValue={stageId}
        aria-label="Move deal to stage"
        className="h-8 text-xs"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </form>
  );
}
