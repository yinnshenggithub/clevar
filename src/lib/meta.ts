import "server-only";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Sends a text message to a Messenger PSID or Instagram-scoped user id via the page token. */
export async function sendMetaMessage(pageAccessToken: string, recipientId: string, text: string): Promise<string> {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
  if (!res.ok || data.error) throw new Error(data.error?.message || `Meta send failed (${res.status})`);
  return data.message_id ?? "";
}

/** Best-effort display name for a Messenger PSID. */
export async function fetchMetaProfileName(pageAccessToken: string, psid: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageAccessToken)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { first_name?: string; last_name?: string };
    const name = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
    return name || null;
  } catch {
    return null;
  }
}

export interface LeadFields {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  raw: Record<string, string>;
}

/** Fetches a Lead Ads submission and maps the common field names. */
export async function fetchMetaLead(leadgenId: string, pageAccessToken: string): Promise<LeadFields | null> {
  try {
    const res = await fetch(`${GRAPH}/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { field_data?: { name: string; values: string[] }[] };
    return mapLeadFields(data.field_data ?? []);
  } catch {
    return null;
  }
}

/** Normalizes Meta/TikTok lead field arrays into our common shape. */
export function mapLeadFields(fields: { name: string; values: string[] }[]): LeadFields {
  const raw: Record<string, string> = {};
  for (const f of fields) raw[f.name.toLowerCase()] = (f.values || []).join(", ");
  const pick = (...keys: string[]) => keys.map((k) => raw[k]).find(Boolean);
  return {
    fullName: pick("full_name", "name", "full name"),
    firstName: pick("first_name", "first name"),
    lastName: pick("last_name", "last name"),
    email: pick("email", "email_address", "work_email"),
    phone: pick("phone_number", "phone", "phone number", "mobile"),
    companyName: pick("company_name", "company", "company name"),
    raw,
  };
}
