"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

/** Object selector for the Properties settings page — navigates to ?object=<token>. */
export function ObjectPicker({
  objects,
  value,
}: {
  objects: { token: string; label: string }[];
  value: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={value}
      onChange={(e) => router.push(`/app/settings/properties?object=${encodeURIComponent(e.target.value)}`)}
      aria-label="Select an object"
      className="w-64"
    >
      {objects.map((o) => (
        <option key={o.token} value={o.token}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
