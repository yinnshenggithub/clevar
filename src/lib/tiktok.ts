import "server-only";
import { mapLeadFields, type LeadFields } from "./meta";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Normalizes a TikTok Lead Generation webhook payload (shapes vary by API version). */
export function normalizeTikTokLead(payload: any): { advertiserId?: string; formId?: string; lead: LeadFields } {
  const data = payload?.data ?? payload ?? {};
  const advertiserId = String(data.advertiser_id ?? payload?.advertiser_id ?? "") || undefined;
  const formId = String(data.page_id ?? data.form_id ?? data.lead_form_id ?? "") || undefined;

  const fd = data.field_data ?? data.fields ?? data.lead?.field_data ?? data.answers ?? [];
  let pairs: { name: string; values: string[] }[] = [];
  if (Array.isArray(fd)) {
    pairs = fd.map((f: any) => ({
      name: String(f.name ?? f.field_name ?? f.key ?? f.question ?? ""),
      values: f.values ?? (f.value != null ? [String(f.value)] : f.answer != null ? [String(f.answer)] : []),
    }));
  } else if (fd && typeof fd === "object") {
    pairs = Object.entries(fd).map(([k, v]) => ({ name: k, values: [String(v)] }));
  }
  return { advertiserId, formId, lead: mapLeadFields(pairs) };
}
